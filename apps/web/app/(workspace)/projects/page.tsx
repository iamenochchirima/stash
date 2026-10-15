import { ProjectsWorkspace } from "../../../components/projects/projects-workspace";
import {
  requireUser,
  queryString,
  withQuery,
  type PageQuery,
} from "../../../lib/server-session";
export const metadata = { title: "Projects · Stash" };
export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<PageQuery>;
}) {
  const query = await searchParams;
  await requireUser(withQuery("/projects", query));
  return <ProjectsWorkspace initialQuery={queryString(query)} />;
}
