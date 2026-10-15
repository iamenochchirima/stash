const channelName="stash-account-session",source=typeof window==="undefined"?"server":crypto.randomUUID();
export function clearItemDrafts(){try{for(const key of Object.keys(sessionStorage))if(key.startsWith("stash-draft:")||key==="stash-lifecycle-feedback")sessionStorage.removeItem(key);}catch{/* Storage can be disabled. */}}
export function scopeItemDraftsToUser(userId:string){try{const previous=sessionStorage.getItem("stash-active-user");if(previous&&previous!==userId)clearItemDrafts();sessionStorage.setItem("stash-active-user",userId);}catch{/* Capture still works without storage. */}}
function send(message:{type:"ended"|"changed";userId?:string}){try{const channel=new BroadcastChannel(channelName);channel.postMessage({...message,source});channel.close();}catch{/* Request-level account checks remain authoritative. */}}
export function endBrowserSession(){clearItemDrafts();try{sessionStorage.removeItem("stash-active-user");}catch{}send({type:"ended"});}
export function announceBrowserAccount(userId:string){scopeItemDraftsToUser(userId);send({type:"changed",userId});}
export function listenForAccountChange(userId:string,onChange:()=>void){
 try{const channel=new BroadcastChannel(channelName);channel.onmessage=event=>{const message=event.data;if(message?.source===source)return;if(message?.type==="ended"||message?.type==="changed"&&message.userId!==userId){clearItemDrafts();try{sessionStorage.removeItem("stash-active-user");}catch{}onChange();}};return()=>channel.close();}catch{return()=>{};}
}
