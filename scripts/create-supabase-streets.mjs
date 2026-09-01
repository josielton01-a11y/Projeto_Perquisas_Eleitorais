import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const input = readFileSync("dados_entrada/ruas_bonito_geocodificadas.csv", "utf8").replace(/^\uFEFF/, "");
function parseCsv(text) { const rows=[]; let row=[],cell="",quoted=false; for(let i=0;i<text.length;i++){const c=text[i],n=text[i+1]; if(c==='"'&&quoted&&n==='"'){cell+='"';i++;}else if(c==='"')quoted=!quoted;else if(c===','&&!quoted){row.push(cell);cell="";}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&n==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell="";}else cell+=c;} if(cell||row.length){row.push(cell);rows.push(row);} const headers=rows.shift().map(x=>x.trim()); return rows.map(values=>Object.fromEntries(headers.map((h,i)=>[h,(values[i]||"").trim()]))); }
const escape = value => { const text=String(value??""); return /[",\r\n]/.test(text)?`"${text.replaceAll('"','""')}"`:text; };
const rows=parseCsv(input).filter(row=>row["LOGRADOURO/NOME"]).map((row,index)=>[index+1,1,row["LOGRADOURO/NOME"],row.CEP,row["DISTRITO/POVOADO"],row.BAIRRO,row.LOTEAMENTO,row.LATITUDE,row.LONGITUDE]);
mkdirSync("supabase/seed",{recursive:true});
writeFileSync("supabase/seed/pulso_ruas.csv",["id,cidade_id,nome,cep,distrito,bairro,loteamento,latitude,longitude",...rows.map(row=>row.map(escape).join(","))].join("\n"));
console.log(`${rows.length} ruas preparadas; ${rows.filter(row=>row[7]&&row[8]).length} com coordenadas.`);
