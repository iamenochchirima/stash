import { currentUser } from "../../lib/server-session";
import { WorkspaceProvider } from "../../components/workspace/workspace";
export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  return user ? (
    <WorkspaceProvider key={user.id} initialUser={user}>
      {children}
    </WorkspaceProvider>
  ) : (
    children
  );
}
