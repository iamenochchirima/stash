import { ProjectsWorkspace } from "../../../../components/projects/projects-workspace";
import {
  requireUser,
  queryString,
  withQuery,
  type PageQuery,
} from "../../../../lib/server-session";
export const metadata = { title: "Project · Stash" };
export default async function ProjectsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<PageQuery>;
}) {
  const { id } = await params;
  const query = await searchParams;
  await requireUser(withQuery(`/projects/${id}`, query));
  return <ProjectsWorkspace id={id} initialQuery={queryString(query)} />;
}
