import { ProjectsWorkspace } from "../../projects-workspace";
export default async function ProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <ProjectsWorkspace id={(await params).id} />;
}
