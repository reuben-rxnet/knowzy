// AI Document Studio M3 -- Download Word / Download PDF (§11.7).
//
// The browser never calls the API, so a download is proxied here: the server
// asks the API as the selected subject (which audits the download and decides
// the permission) and streams the file back with the API's own headers.

import { apiRaw } from '../../../../lib/api';

export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ versionId: string }> },
): Promise<Response> {
  const { versionId } = await params;
  const format = new URL(request.url).searchParams.get('format') === 'pdf' ? 'pdf' : 'docx';
  const upstream = await apiRaw(
    `/api/v1/authoring/document-studio/versions/${encodeURIComponent(versionId)}/download?format=${format}`,
  );
  if (!upstream.ok) {
    return new Response('The download is not available.', {
      status: upstream.status,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }
  const headers = new Headers();
  for (const name of ['content-type', 'content-disposition', 'cache-control']) {
    const value = upstream.headers.get(name);
    if (value !== null) headers.set(name, value);
  }
  return new Response(await upstream.arrayBuffer(), { status: 200, headers });
}
