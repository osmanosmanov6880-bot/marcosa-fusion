/*
 * R54: strict, dependency-free PNG cover normalizer for an isolated local lab.
 * Not a general image decoder; deliberately accepts only 8-bit RGB / RGBA
 * noninterlaced PNGs. Rebuilds a new PNG from verified inflated scanlines,
 * dropping ALL metadata, embedded ICC, text, APNG and unknown chunks.
 */
import {inflateSync,deflateSync} from 'node:zlib';

export const MAX_COVER_BYTES=786432;
export const MAX_COVER_PIXELS=1_500_000;
const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10]);
const CRC_TABLE=Array.from({length:256},(_,value)=>{
 let c=value;
 for(let i=0;i<8;i++)c=(c&1)?(0xedb88320^(c>>>1)):(c>>>1);
 return c>>>0;
});
function crc32(data){
 let c=0xffffffff;
 for(const byte of data)c=CRC_TABLE[(c^byte)&255]^(c>>>8);
 return (c^0xffffffff)>>>0;
}
function fail(){throw new Error('INVALID_PNG_COVER');}
function chunk(name,payload){
 const type=Buffer.from(name,'ascii');
 const out=Buffer.alloc(12+payload.length);
 out.writeUInt32BE(payload.length,0);
 type.copy(out,4);payload.copy(out,8);
 out.writeUInt32BE(crc32(out.subarray(4,8+payload.length)),8+payload.length);
 return out;
}
export function sanitizePngCover(input){
 if(!Buffer.isBuffer(input)||input.length<57||input.length>MAX_COVER_BYTES
   ||!input.subarray(0,8).equals(SIGNATURE))fail();
 let offset=8,ihdr=null,seenIdat=false,doneIdat=false,finished=false,parts=[];
 let width=0,height=0,channels=0,n=0;
 while(offset<input.length){
  if(++n>128||offset+12>input.length)fail();
  const length=input.readUInt32BE(offset),end=offset+12+length;
  if(length>MAX_COVER_BYTES||end>input.length)fail();
  const type=input.toString('ascii',offset+4,offset+8);
  if(!/^[A-Za-z]{4}$/.test(type)||type[2]!==type[2].toUpperCase())fail();
  const body=input.subarray(offset+8,offset+8+length);
  const expected=input.readUInt32BE(end-4);
  if(crc32(input.subarray(offset+4,end-4))!==expected)fail();
  if(ihdr===null&&type!=='IHDR')fail();
  if(type==='IHDR'){
   if(ihdr||length!==13||offset!==8)fail();
   width=body.readUInt32BE(0);height=body.readUInt32BE(4);
   channels=body[9]===2?3:body[9]===6?4:0;
   if(width<1||height<1||width>1600||height>1600
     ||width*height>MAX_COVER_PIXELS||body[8]!==8||!channels
     ||body[10]!==0||body[11]!==0||body[12]!==0)fail();
   ihdr=Buffer.from(body);
  }else if(type==='IDAT'){
   if(doneIdat||length===0)fail();
   seenIdat=true;parts.push(Buffer.from(body));
  }else if(type==='IEND'){
   if(!seenIdat||length!==0||end!==input.length)fail();
   finished=true;
   break;
  }else{
   // No animation or other critical data is permitted. Ancillary metadata
   // may be present on input, but it is never copied to the output.
   if(type[0]===type[0].toUpperCase()||['acTL','fcTL','fdAT'].includes(type))fail();
   if(seenIdat)doneIdat=true;
  }
  offset=end;
 }
 if(!finished||!seenIdat||!ihdr)fail();
 const rowLength=1+width*channels,expectedRaw=rowLength*height;
 let raw;
 try{
  raw=inflateSync(Buffer.concat(parts),{maxOutputLength:expectedRaw+1});
 }catch{fail();}
 if(raw.length!==expectedRaw)fail();
 for(let y=0;y<height;y++)if(raw[y*rowLength]>4)fail();
 const clean=Buffer.concat([SIGNATURE,chunk('IHDR',ihdr),
  chunk('IDAT',deflateSync(raw,{level:6})),chunk('IEND',Buffer.alloc(0))]);
 if(clean.length>MAX_COVER_BYTES)fail();
 return {png:clean,width,height,bytes:clean.length};
}
