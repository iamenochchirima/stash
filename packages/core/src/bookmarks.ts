import { eq, and, sql } from "drizzle-orm";
import { resources,collections,type Database } from "@stash/db";
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c]!);
export async function exportBookmarks(db:Database,userId:string){
 const rows=await db.select({url:resources.url,title:resources.title,kind:resources.kind,projectId:resources.projectId,deletedAt:resources.deletedAt}).from(resources).where(eq(resources.userId,userId)).orderBy(resources.createdAt,resources.id);
 const links=rows.filter(row=>{if(row.kind!=="link"||row.projectId||row.deletedAt||!row.url)return false;try{const url=new URL(row.url);return["http:","https:"].includes(url.protocol)&&!url.username&&!url.password;}catch{return false;}});
 const omitted=rows.length-links.length;
 const[count]=await db.select({total:sql<number>`count(*)::int`}).from(collections).where(and(eq(collections.userId,userId),eq(collections.kind,"topic")));
 const topicsOmitted=count.total;
 const header='<!DOCTYPE NETSCAPE-Bookmark-file-1>\n<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">\n<TITLE>Stash bookmarks</TITLE>\n<H1>Stash bookmarks</H1>\n'+`<p>Link titles and URLs only. ${omitted} other ${omitted===1?"item":"items"} omitted. ${topicsOmitted?`${topicsOmitted} ${topicsOmitted===1?"topic and its memberships":"topics and their memberships"} omitted. `:""}Use a Stash backup to keep full content and organisation.</p>\n<DL><p>\n`;
 return{links:links.length,omitted,topicsOmitted,*parts(){yield header;for(const row of links)yield`<DT><A HREF="${escape(row.url!)}">${escape(row.title||new URL(row.url!).hostname)}</A>\n`;yield'</DL><p>\n';}};

}
