// biome-ignore-all lint/performance/noAwaitInLoops: small sequential parser fixtures
import { describe, expect, test } from "bun:test";
import { readIssues } from "./channel";

const TIME = /<time.*?<\/time>/;
const SOURCE_LINE = /↗.*$/;
const heading = "🗞️ AI за два дня · 3 июня";
const entry =
  '<i class="emoji"><b>🧠</b></i> <b>AI &amp; наука</b><br/>Текст &lt;tag&gt; &#x1F680; &quot;да&quot;.<br/>↗ <a href="https://example.com/news?a=1&amp;b=2">Источник &amp; Co</a>';
function post(
  body: string,
  id = "bestburyat/42",
  time = "2026-06-03T12:00:00+00:00"
) {
  return `<div class="tgme_widget_message" data-post="${id}"><div class="tgme_widget_message_text js-message_text" dir="auto">${body}</div><a class="tgme_widget_message_date"><time datetime="${time}">12:00</time></a></div>`;
}
const digest = (entries = [entry], title = heading) =>
  `${title}<br/><br/>${entries.join("<br/><br/>")}`;
const read = (html: string) => readIssues(new Response(html));

describe("readIssues", () => {
  test("reads actual Telegram emoji wrappers and decodes text and href once", async () => {
    expect(await read(post(digest()))).toEqual([
      {
        date: "2026-06-03",
        post: 42,
        stories: [
          {
            source: "Источник & Co",
            text: 'Текст <tag> 🚀 "да".',
            title: "AI & наука",
            url: "https://example.com/news?a=1&b=2",
          },
        ],
      },
    ]);
  });

  test("accepts one through four entries, variation-free heading and bold heading", async () => {
    for (let count = 1; count <= 4; count += 1) {
      const issues = await read(
        post(
          digest(
            new Array(count).fill(entry),
            '<b>🗞 </b><mark class="highlight"><b>AI</b></mark><b> за два дня · 3 июня</b>'
          )
        )
      );
      expect(issues[0]?.stories).toHaveLength(count);
    }
  });

  test("sorts by numeric post descending, not heading date or document order", async () => {
    const issues = await read(
      post(digest(), "bestburyat/9") +
        post(digest([entry], "🗞 AI за два дня · 2 июня"), "bestburyat/100")
    );
    expect(issues.map((issue) => issue.post)).toEqual([100, 9]);
  });

  test("ignores other channels, noninteger IDs, legacy and urgent posts", async () => {
    const html = [
      "other/42",
      "bestburyat/42x",
      "bestburyat/4.2",
      "bestburyat/-1",
      "bestburyat/9007199254740993",
    ]
      .map((id) => post(digest(), id))
      .join("");
    expect(
      await read(
        html +
          [
            "🗞 AI за день · 3 июня",
            "Срочно!",
            `Вступление<br/>${heading}`,
            `${heading} — новости`,
          ]
            .map((title) => post(digest([entry], title)))
            .join("")
      )
    ).toEqual([]);
  });

  test("uses timestamp year, including December digests posted in January", async () => {
    const issues = await read(
      post(
        digest([entry], "🗞 AI за два дня · 31 декабря"),
        "bestburyat/1",
        "2027-01-01T01:00:00+03:00"
      )
    );
    expect(issues[0]?.date).toBe("2026-12-31");
    expect(
      (
        await read(
          post(
            digest([entry], "🗞 AI за два дня · 29 февраля"),
            "bestburyat/2",
            "2024-03-01T00:00:00Z"
          )
        )
      )[0]?.date
    ).toBe("2024-02-29");
  });

  test("rejects impossible heading dates and invalid or missing timestamps", async () => {
    for (const title of [
      "31 апреля",
      "29 февраля",
      "0 июня",
      "32 июня",
      "3 июнь",
    ]) {
      expect(
        await read(post(digest([entry], `🗞 AI за два дня · ${title}`)))
      ).toEqual([]);
    }
    for (const time of [
      "",
      "garbage",
      "2026-02-30T12:00:00Z",
      "2026-13-03T12:00:00Z",
    ]) {
      expect(await read(post(digest(), "bestburyat/42", time))).toEqual([]);
    }
    expect(await read(post(digest()).replace(TIME, ""))).toEqual([]);
  });

  test("rejects entire malformed digests rather than retaining good entries", async () => {
    const malformed = [
      entry.replace("<b>AI &amp; наука</b>", "AI &amp; наука"),
      entry.replace("Текст &lt;tag&gt; &#x1F680; &quot;да&quot;.", ""),
      entry.replace(SOURCE_LINE, "Источник"),
      entry.replace("🧠", "not-emoji"),
      entry.replace("Источник &amp; Co", ""),
      `${entry} лишнее`,
      entry.replace("</a>", '</a><a href="https://other.test">Other</a>'),
      entry.replace("Текст", "<script>alert(1)</script>Текст"),
    ];
    for (const invalid of malformed) {
      expect(await read(post(digest([entry, invalid])))).toEqual([]);
    }
    expect(await read(post(digest([])))).toEqual([]);
    expect(await read(post(digest(new Array(5).fill(entry))))).toEqual([]);
    expect(
      await read(
        post(digest()) + post(digest([malformed[0] ?? ""]), "bestburyat/43")
      )
    ).toHaveLength(1);
  });

  test("only accepts safe absolute HTTP(S) source links", async () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,x",
      "//example.com",
      "/relative",
      "ftp://example.com",
      "https://",
      "https://user:pass@example.com",
      "https://example.com/&#10;x",
      "https://example.com\\evil",
    ]) {
      expect(
        await read(
          post(
            digest([entry.replace("https://example.com/news?a=1&amp;b=2", url)])
          )
        )
      ).toEqual([]);
    }
    expect(
      await read(
        post(
          digest([
            entry.replace(
              "https://example.com/news?a=1&amp;b=2",
              "http://example.com"
            ),
          ])
        )
      )
    ).toHaveLength(1);
  });

  test("ignores site chrome and does not decode escaped markup twice", async () => {
    const html = `<script>bad</script><h1>Site HTML</h1>${post(digest([entry.replace("Текст", "&amp;lt;b&amp;gt;")]))}`;
    expect((await read(html))[0]?.stories[0]?.text).toBe(
      '&lt;b&gt; <tag> 🚀 "да".'
    );
  });

  test("handles streaming chunks split inside entities and markup", async () => {
    const bytes = new TextEncoder().encode(post(digest()));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += 7) {
          controller.enqueue(bytes.slice(offset, offset + 7));
        }
        controller.close();
      },
    });
    expect(await readIssues(new Response(stream))).toEqual(
      await read(post(digest()))
    );
  });
});
