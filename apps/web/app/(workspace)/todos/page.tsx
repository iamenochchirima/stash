import { TodoWorkspace } from "../../../components/todos/todo-workspace";
import { requireUser, queryString, withQuery, type PageQuery } from "../../../lib/server-session";

export const metadata={title:"Todos · Stash"};
export default async function TodosPage({searchParams}:{searchParams:Promise<PageQuery>}){
  const query=await searchParams;
  await requireUser(withQuery("/todos",query));
  return <TodoWorkspace initialQuery={queryString(query)}/>;
}
