/**
 * Renders one or more schema.org JSON-LD blocks as <script type="application/ld+json">.
 * Server-safe (no "use client") so the structured data is in the initial HTML
 * that crawlers read. Pass a single object or an array.
 */
export function JsonLd({ data }: { data: object | object[] }) {
  const blocks = Array.isArray(data) ? data : [data];
  return (
    <>
      {blocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          // JSON.stringify output is safe here; escape "<" to avoid closing the
          // script tag early if any string value contains one.
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(block).replace(/</g, "\\u003c"),
          }}
        />
      ))}
    </>
  );
}

export default JsonLd;
