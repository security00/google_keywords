import fs from "fs";
import path from "path";

export const dynamic = "force-static";

async function getApiDocs() {
  const filePath = path.join(process.cwd(), "API.md");
  const content = fs.readFileSync(filePath, "utf-8");
  return content;
}

export default async function ApiDocsPage() {
  const content = await getApiDocs();

  // 简单的 Markdown 转换（标题/代码块/粗体）
  const html = content
    .replace(/^# (.*$)/gim, "<h1>$1</h1>")
    .replace(/^## (.*$)/gim, "<h2>$1</h2>")
    .replace(/^### (.*$)/gim, "<h3>$1</h3>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/```(\w+)?\n([\s\S]*?)```/g, "<pre><code>$2</code></pre>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");

  return (
    <div className="mx-auto max-w-4xl py-10">
      <h1 className="mb-6 text-3xl font-bold">API 文档</h1>
      <div
        className="prose prose-slate dark:prose-invert max-w-none"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
