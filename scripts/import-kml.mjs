import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const dataDir=path.join(root,'dados_entrada');
const kmlFile=fs.readdirSync(dataDir).find(name=>name.toLowerCase().endsWith('.kml'));
if(!kmlFile) throw new Error('Nenhum arquivo KML encontrado em dados_entrada.');

function parseCsv(input){const rows=[];let row=[],cell='',quoted=false;for(let i=0;i<input.length;i++){const c=input[i],next=input[i+1];if(c==='"'&&quoted&&next==='"'){cell+='"';i++}else if(c==='"')quoted=!quoted;else if(c===','&&!quoted){row.push(cell);cell=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&next==='\n')i++;row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell=''}else cell+=c}if(cell||row.length){row.push(cell);rows.push(row)}const headers=rows.shift();return rows.map(values=>Object.fromEntries(headers.map((header,index)=>[header.trim(),(values[index]||'').trim()]))) }
const normalize=value=>(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase().replace(/[^A-Z0-9]/g,'');
const decode=value=>(value||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'");
function centerPoint(coords){if(!coords.length)return null;if(coords.length===1)return coords[0];const lengths=[];let total=0;for(let i=1;i<coords.length;i++){const [x1,y1]=coords[i-1],[x2,y2]=coords[i];const length=Math.hypot(x2-x1,y2-y1);lengths.push(length);total+=length}let walked=0;for(let i=0;i<lengths.length;i++){if(walked+lengths[i]>=total/2){const ratio=(total/2-walked)/lengths[i];return [coords[i][0]+(coords[i+1][0]-coords[i][0])*ratio,coords[i][1]+(coords[i+1][1]-coords[i][1])*ratio]}walked+=lengths[i]}return coords.at(-1)}

const csv=parseCsv(fs.readFileSync(path.join(dataDir,'ruas_bonito.csv'),'utf8'));
const kml=fs.readFileSync(path.join(dataDir,kmlFile),'utf8');
const placemarks=[...kml.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/gi)].map(match=>match[0]);
const geo=placemarks.map(block=>{const fields=Object.fromEntries([...block.matchAll(/<SimpleData\s+name="([^"]+)">([\s\S]*?)<\/SimpleData>/gi)].map(m=>[m[1],decode(m[2].trim())]));const coordinateText=[...block.matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/gi)].map(m=>m[1]).join(' ');const coords=coordinateText.trim().split(/\s+/).map(pair=>pair.split(',').slice(0,2).map(Number)).filter(pair=>pair.length===2&&pair.every(Number.isFinite));const center=centerPoint(coords);return {name:fields['Tabela_Ruas_Tudo_LOGRADOURO_NOME']||'',cep:fields['Tabela_Ruas_Tudo_CEP']||'',center,line:coords}}).filter(item=>item.name&&item.center);

const byNameCep=new Map(geo.map(item=>[`${normalize(item.name)}|${normalize(item.cep)}`,item]));
const byName=new Map();for(const item of geo){const key=normalize(item.name);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(item)}
const byCep=new Map();for(const item of geo){const key=normalize(item.cep);if(!key)continue;if(!byCep.has(key))byCep.set(key,[]);byCep.get(key).push(item)}
const mergeCandidates=candidates=>{const points=candidates.flatMap(candidate=>candidate.line);const center=[points.reduce((sum,p)=>sum+p[0],0)/points.length,points.reduce((sum,p)=>sum+p[1],0)/points.length];return {...candidates[0],center,line:points}};
let exact=0,nameOnly=0,cepOnly=0,unmatched=0;
const linked=csv.map((street,index)=>{const key=`${normalize(street['LOGRADOURO/NOME'])}|${normalize(street.CEP)}`;let match=byNameCep.get(key),method='nome_cep';if(!match){const candidates=byName.get(normalize(street['LOGRADOURO/NOME']))||[];if(candidates.length){match=mergeCandidates(candidates);method='nome'}}if(!match){const candidates=byCep.get(normalize(street.CEP))||[];if(candidates.length){match=mergeCandidates(candidates);method='cep'}}if(!match){unmatched++;return {...street,LATITUDE:'',LONGITUDE:'',METODO_VINCULO:''}}if(method==='nome_cep')exact++;else if(method==='nome')nameOnly++;else cepOnly++;return {...street,LATITUDE:match.center[1].toFixed(7),LONGITUDE:match.center[0].toFixed(7),METODO_VINCULO:method,_line:match.line}});
const headers=[...Object.keys(csv[0]),'LATITUDE','LONGITUDE','METODO_VINCULO'];
const escape=value=>{const text=String(value??'');return /[",\r\n]/.test(text)?`"${text.replace(/"/g,'""')}"`:text};
fs.writeFileSync(path.join(dataDir,'ruas_bonito_geocodificadas.csv'),'\ufeff'+headers.map(escape).join(',')+'\n'+linked.map(row=>headers.map(header=>escape(row[header])).join(',')).join('\n'));
fs.mkdirSync(path.join(root,'src','data'),{recursive:true});
fs.writeFileSync(path.join(root,'src','data','streetCoordinates.json'),JSON.stringify(linked.filter(row=>row.LATITUDE).map((row,index)=>({id:index+1,name:row['LOGRADOURO/NOME'],cep:row.CEP,neighborhood:row.BAIRRO,district:row['DISTRITO/POVOADO'],lat:Number(row.LATITUDE),lng:Number(row.LONGITUDE),line:row._line})),null,2));
fs.writeFileSync(path.join(dataDir,'relatorio_vinculo_kml.json'),JSON.stringify({arquivo:kmlFile,registrosCsv:csv.length,placemarksComCoordenadas:geo.length,vinculadosNomeCep:exact,vinculadosSomenteNome:nameOnly,vinculadosSomenteCep:cepOnly,naoVinculados:unmatched},null,2));
console.log(JSON.stringify({arquivo:kmlFile,registrosCsv:csv.length,placemarksComCoordenadas:geo.length,vinculadosNomeCep:exact,vinculadosSomenteNome:nameOnly,vinculadosSomenteCep:cepOnly,naoVinculados:unmatched},null,2));
