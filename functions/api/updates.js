/**
 * Cloudflare Pages Function: /api/updates
 *
 * Queries the Notion Latest Updates database and returns only the five
 * public columns (Date, Source, Type, Title, Link) plus Section and Related
 * links for all Approved rows, newest first. Rows with no Section count as Latest Updates. The NOTION_TOKEN env var is never exposed to the browser.
 */

const DATABASE_ID = '36594e32-0512-4a2b-9db1-82ba811f3cb5';

export async function onRequest(context) {
  const token = context.env.NOTION_TOKEN;

  if (!token) {
    return new Response(JSON.stringify({ error: 'Server configuration error' }), {
      status: 500,
      headers: corsHeaders('application/json'),
    });
  }

  try {
    const notionRes = await fetch(
      `https://api.notion.com/v1/databases/${DATABASE_ID}/query`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          filter: {
            property: 'Status',
            select: { equals: 'Approved' },
          },
          sorts: [
            { property: 'Date', direction: 'descending' },
          ],
          page_size: 100,
        }),
      }
    );

    if (!notionRes.ok) {
      const err = await notionRes.text();
      console.error('Notion API error:', notionRes.status, err);
      return new Response(JSON.stringify({ error: 'Failed to fetch from Notion' }), {
        status: 502,
        headers: corsHeaders('application/json'),
      });
    }

    const data = await notionRes.json();

    // Strip everything private: only the five public columns plus Section
    const items = data.results.map((page) => {
      const p = page.properties;
      return {
        date:   p.Date?.date?.start   ?? null,
        source: p.Source?.select?.name ?? null,
        type:   p.Type?.select?.name   ?? null,
        title:  p.Title?.title?.[0]?.plain_text ?? null,
        link:   p.Link?.url            ?? null,
        section: p.Section?.select?.name ?? 'Latest Updates',
        related: parseRelated(p['Related links']?.rich_text),
      };
    }).filter(item => item.title); // skip any rows with no title

    return new Response(JSON.stringify({ items }), {
      status: 200,
      headers: corsHeaders('application/json'),
    });

  } catch (err) {
    console.error('Unexpected error:', err);
    return new Response(JSON.stringify({ error: 'Unexpected server error' }), {
      status: 500,
      headers: corsHeaders('application/json'),
    });
  }
}

// "Related links" is a text column, one link per line: "Label | https://...".
// Only http(s) links with a label are passed on; anything else is dropped.
function parseRelated(richText) {
  if (!Array.isArray(richText) || richText.length === 0) return [];
  const text = richText.map((t) => t.plain_text || '').join('');
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const bar = line.lastIndexOf('|');
    if (bar < 0) continue;
    const label = line.slice(0, bar).trim();
    const url = line.slice(bar + 1).trim();
    if (!label || !/^https?:\/\/\S+$/i.test(url)) continue;
    out.push({ label: label.slice(0, 200), url });
    if (out.length >= 6) break;
  }
  return out;
}

function corsHeaders(contentType) {
  return {
    'Content-Type': contentType,
    'Cache-Control': 'public, max-age=300', // 5-minute cache at the CDN edge
    'Access-Control-Allow-Origin': '*',
  };
}
