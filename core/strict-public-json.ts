/** Read only bounded public request/response files, never wallet secrets. */
export async function readStrictPublicJsonFile(file:Pick<File,'size'|'arrayBuffer'>,maximumBytes=65536):Promise<Record<string,unknown>> {
  if(!Number.isSafeInteger(maximumBytes)||maximumBytes<1||maximumBytes>65536)throw Error('Invalid public file limit.');
  if(!Number.isSafeInteger(file.size)||file.size<0||file.size>maximumBytes)throw Error('Public file is too large.');
  const bytes=await file.arrayBuffer();
  if(bytes.byteLength>maximumBytes)throw Error('Public file is too large.');
  let text:string;
  try{text=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);}catch{throw Error('Public file must contain valid UTF-8 JSON.');}
  const value=parseStrictPublicJson(text,maximumBytes);
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Public file must contain a JSON object.');
  return value as Record<string,unknown>;
}

/** Reject duplicate keys before JSON normalization. Public import files only. */
export function parseStrictPublicJson(text: string, maximumBytes = 65536): unknown {
  if (new TextEncoder().encode(text).length > maximumBytes) throw Error('Public file is too large.');
  let i = 0, nodes = 0;
  function space() { while (/[\x20\t\r\n]/.test(text[i] ?? '\0')) i++; }
  function string(): string {
    const start = i++;
    for (; i < text.length; i++) {
      if (text[i] === '\\') { i++; continue; }
      if (text[i] === '"') return JSON.parse(text.slice(start, ++i)) as string;
    }
    throw Error('Incomplete JSON string.');
  }
  function value(depth: number): void {
    if (++nodes > 4096 || depth > 24) throw Error('Public file is too complex.');
    space();
    if (text[i] === '{') {
      i++; space(); const seen = new Set<string>();
      if (text[i] === '}') { i++; return; }
      while (true) {
        if (text[i] !== '"') throw Error('Invalid JSON object.');
        const key = string();
        if (seen.has(key)) throw Error('Duplicate JSON key.');
        seen.add(key); space();
        if (text[i++] !== ':') throw Error('Invalid JSON field.');
        value(depth + 1); space();
        const next = text[i++]; if (next === '}') return;
        if (next !== ',') throw Error('Invalid JSON object.');
        space();
      }
    }
    if (text[i] === '[') {
      i++; space(); if (text[i] === ']') { i++; return; }
      while (true) {
        value(depth + 1); space(); const next = text[i++];
        if (next === ']') return; if (next !== ',') throw Error('Invalid JSON array.');
      }
    }
    if (text[i] === '"') { string(); return; }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(i));
    if (!match) throw Error('Invalid JSON value.');
    i += match[0].length;
  }
  value(0); space(); if (i !== text.length) throw Error('Unexpected data after JSON.');
  return JSON.parse(text);
}
