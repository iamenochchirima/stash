const minuteMs=60_000;
type Wall={year:number;month:number;day:number;hour:number;minute:number};
function parseWall(value:string):Wall{
  const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if(!match)throw new Error("Enter a valid local date and time.");
  const [,y,m,d,h,mm]=match,wall={year:Number(y),month:Number(m),day:Number(d),hour:Number(h),minute:Number(mm)};
  const roundtrip=new Date(Date.UTC(wall.year,wall.month-1,wall.day,wall.hour,wall.minute));
  if(roundtrip.getUTCFullYear()!==wall.year||roundtrip.getUTCMonth()!==wall.month-1||roundtrip.getUTCDate()!==wall.day||wall.hour>23||wall.minute>59)throw new Error("Enter a valid local date and time.");
  return wall;
}
function formatter(timeZone:string){
  try{return new Intl.DateTimeFormat("en-GB-u-ca-iso8601-nu-latn",{timeZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});}
  catch{throw new Error("Choose a valid IANA time zone.");}
}
function wallAt(date:Date,format:Intl.DateTimeFormat):Wall{
  const parts=Object.fromEntries(format.formatToParts(date).map(part=>[part.type,part.value]));
  return {year:Number(parts.year),month:Number(parts.month),day:Number(parts.day),hour:Number(parts.hour),minute:Number(parts.minute)};
}
function wallKey(value:Wall){return `${value.year}-${String(value.month).padStart(2,"0")}-${String(value.day).padStart(2,"0")}T${String(value.hour).padStart(2,"0")}:${String(value.minute).padStart(2,"0")}`;}
function wallFromNominal(value:number):Wall{const d=new Date(value);return{year:d.getUTCFullYear(),month:d.getUTCMonth()+1,day:d.getUTCDate(),hour:d.getUTCHours(),minute:d.getUTCMinutes()};}
function offsetsAround(nominal:number,format:Intl.DateTimeFormat){
  const offsets=new Set<number>();
  for(let hours=-36;hours<=36;hours+=6){const instant=nominal+hours*60*minuteMs,shown=wallAt(new Date(instant),format),offset=Date.UTC(shown.year,shown.month-1,shown.day,shown.hour,shown.minute)-Math.floor(instant/minuteMs)*minuteMs;offsets.add(offset);}
  return [...offsets];
}
function matchingInstants(target:Wall,format:Intl.DateTimeFormat,offsets:number[]){
  const nominal=Date.UTC(target.year,target.month-1,target.day,target.hour,target.minute),key=wallKey(target),matches:number[]=[];
  for(const offset of offsets){const instant=nominal-offset;if(wallKey(wallAt(new Date(instant),format))===key)matches.push(instant);}
  return matches.sort((a,b)=>a-b);
}
/** Convert a wall-clock input to UTC. Gaps advance to the next valid minute; repeats choose the earlier instant. */
export function localDateTimeToUtc(value:string,timeZone:string):string{
  const format=formatter(timeZone),wall=parseWall(value),nominal=Date.UTC(wall.year,wall.month-1,wall.day,wall.hour,wall.minute),offsets=offsetsAround(nominal,format);
  for(let advance=0;advance<=24*60;advance++){
    const target=wallFromNominal(nominal+advance*minuteMs),matches=matchingInstants(target,format,offsets);
    if(matches.length)return new Date(matches[0]).toISOString();
  }
  throw new Error("Could not resolve this local time.");
}
export function utcToLocalDateTime(value:string,timeZone:string):string{
  const date=new Date(value);if(Number.isNaN(date.valueOf()))throw new Error("Enter a valid date and time.");
  const wall=wallAt(date,formatter(timeZone));
  return `${wallKey(wall)}`;
}
