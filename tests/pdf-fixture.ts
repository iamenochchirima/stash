export function pdf(text = "Research survives the conversation") {
  const lines: string[] = []; let line = "";
  for (const word of text.split(/\s+/)) { if (line && line.length + word.length + 1 > 70) { lines.push(line); line = ""; } line += (line ? " " : "") + word; }
  lines.push(line);
  const escaped = lines.map(line=>line.replace(/[\\()]/g, "\\$&"));
  const stream = `BT /F1 12 Tf 14 TL 72 720 Td ${escaped.map((line,index)=>`${index ? "T* " : ""}(${line}) Tj`).join(" ")} ET`;
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>", `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let content = "%PDF-1.4\n", offsets = [0];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(content)); content += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const start = Buffer.byteLength(content);
  content += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(o => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(content);
}
function document(objects:string[]){let content="%PDF-1.4\n";const offsets:number[]=[];for(const[index,object]of objects.entries()){offsets.push(Buffer.byteLength(content));content+=`${index+1} 0 obj\n${object}\nendobj\n`;}const start=Buffer.byteLength(content);content+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n${offsets.map(value=>`${String(value).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;return Buffer.from(content);}
export function pagedPdf(pages:string[]){
 const objects=["<< /Type /Catalog /Pages 2 0 R >>",`<< /Type /Pages /Kids [${pages.map((_,i)=>`${4+i*2} 0 R`).join(" ")}] /Count ${pages.length} >>`,"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
 for(const[index,text]of pages.entries()){
  const lines=text.match(/.{1,65}(?:\s|$)/g)||[text],stream=`BT /F1 12 Tf 14 TL 72 720 Td ${lines.map((line,i)=>`${i?"T* ":""}(${line.replace(/[\\()]/g,"\\$&")}) Tj`).join(" ")} ET`;
  objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${5+index*2} 0 R >>`,`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
 }
 return document(objects);
}
export function imageOnlyPdf(){
 const image="ff0000>",stream="q 100 0 0 100 72 620 cm /Im1 Do Q";
 return document(["<< /Type /Catalog /Pages 2 0 R >>","<< /Type /Pages /Kids [3 0 R] /Count 1 >>","<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Im1 4 0 R >> >> /Contents 5 0 R >>",`<< /Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length ${image.length} >>\nstream\n${image}\nendstream`,`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`]);
}
