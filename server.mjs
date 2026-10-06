import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));
const PORT=Number(process.env.PORT||4177), OLLAMA=process.env.OLLAMA_URL||'http://127.0.0.1:11434';
const COMFY_ROOT=process.env.COMFY_ROOT||path.join(os.homedir(),'ComfyUI-Installs','ComfyUI','ComfyUI');
const OPENMONTAGE=process.env.OPENMONTAGE_DIR||path.join(os.homedir(),'Projeler','OpenMontage');
const out=path.join(here,'renders'); fs.mkdirSync(out,{recursive:true});
const COMFY=process.env.COMFY_URL||'http://127.0.0.1:8188', aiJobs=new Map();
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.mp4':'video/mp4'};
function send(res,status,obj){res.writeHead(status,{'content-type':'application/json; charset=utf-8'});res.end(JSON.stringify(obj));}
function readBody(req){return new Promise((ok,no)=>{let b='';req.on('data',x=>b+=x);req.on('end',()=>{try{ok(JSON.parse(b||'{}'))}catch(e){no(e)}})})}
function run(bin,args,cwd){return new Promise((resolve)=>{const p=spawn(bin,args,{cwd,stdio:['ignore','pipe','pipe']});let log='';p.stdout.on('data',d=>log+=d);p.stderr.on('data',d=>log+=d);p.on('error',e=>resolve({ok:false,log:e.message}));p.on('close',code=>resolve({ok:code===0,log:log.slice(-4000)}))})}
const server=http.createServer(async(req,res)=>{
 try{
  if(req.method==='GET'&&req.url==='/api/status'){
   const ollama=await fetch(OLLAMA+'/api/tags').then(async r=>r.ok?await r.json():null).catch(()=>null);
   const models=ollama?.models||[];
   const ffmpeg=await run('ffmpeg',['-version']);
   const composer=here;
   const weights=path.join(os.homedir(),'real-esrgan-models','weights','RealESRGAN_x4plus.pth');
   const wanFiles=[path.join(COMFY_ROOT,'models/diffusion_models/wan2.1_t2v_1.3B_fp16.safetensors'),path.join(COMFY_ROOT,'models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors'),path.join(COMFY_ROOT,'models/vae/wan_2.1_vae.safetensors')];
   const comfy=await fetch(COMFY+'/system_stats').then(r=>r.ok).catch(()=>false);
   send(res,200,{ollama:!!ollama,models:models.map(m=>m.name),ffmpeg:ffmpeg.ok,remotion:fs.existsSync(path.join(composer,'node_modules/@remotion/renderer')),openmontage:fs.existsSync(OPENMONTAGE),upscaler:fs.existsSync(weights),explainer:fs.existsSync(path.join(os.homedir(),'anything2explainer','SKILL.md')),comfy,wan:wanFiles.every(f=>fs.existsSync(f)),gpu:(await run('nvidia-smi',['--query-gpu=name,memory.total','--format=csv,noheader'])).log.trim()});return
  }
  if(req.method==='POST'&&req.url==='/api/ai-video'){
   const b=await readBody(req);if(!b.prompt?.trim())return send(res,400,{error:'Önce video promptu yazın.'});
   const provider=['veo','higgsfield'].includes(b.provider)?b.provider:'local';if(provider!=='local'&&!b.apiKey)return send(res,400,{error:'Seçilen video API için anahtar girin.'});
   if(provider==='local'&&!(await fetch(COMFY+'/system_stats').then(r=>r.ok).catch(()=>false)))return send(res,503,{error:'ComfyUI çalışmıyor. Yerel AI video motorunu başlatın.'});
   if(provider==='local'&&b.model)await fetch(OLLAMA+'/api/generate',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:b.model,keep_alive:0})}).catch(()=>{});
   const jobId=randomUUID(),clientId=randomUUID(),safe=(b.title||'yerel-ai-klip').normalize('NFKD').replace(/[^\w-]+/g,'-').replace(/^-|-$/g,'').slice(0,36)||'yerel-ai-klip';
   const seconds=Math.max(15,Math.min(90,Number(b.seconds)||30)),totalSegments=Math.ceil(seconds/(provider==='veo'?8:5));
   let prompts=Array.isArray(b.scenePrompts)?b.scenePrompts.filter(x=>typeof x==='string'&&x.trim()).slice(0,totalSegments):[];
   if(!prompts.length)prompts=Array.from({length:totalSegments},(_,i)=>`${b.prompt}. Cinematic shot ${i+1} of ${totalSegments}. Keep the main character and environment visible and consistent.`);
   while(prompts.length<totalSegments)prompts.push(prompts[prompts.length-1]);
   const job={id:jobId,state:'connecting',progress:0,message:provider==='local'?'ComfyUI ile bağlantı kuruluyor…':'Seçilen bulut video API’sine bağlanıyor…',createdAt:Date.now(),file:null,error:null,seconds,totalSegments,segmentIndex:0,prompts,clips:[],safe,seed:Math.floor(Math.random()*2147483000),clientId,provider,apiKey:b.apiKey,videoModel:b.videoModel,ratio:b.ratio||'16:9',resolution:b.resolution||'720p'};aiJobs.set(jobId,job);
   if(provider!=='local'){runCloudVideoJob(job).catch(e=>{job.state='error';job.error=e.message;job.message='Bulut video üretimi tamamlanamadı.'});return send(res,202,{id:jobId,state:job.state})}
   const ws=new WebSocket(COMFY.replace(/^http/,'ws')+`/ws?clientId=${clientId}`);
   job.ws=ws;
   ws.addEventListener('message',ev=>{try{const msg=JSON.parse(String(ev.data)),d=msg.data||{};if(d.prompt_id&&job.comfyId&&d.prompt_id!==job.comfyId)return;if(msg.type==='progress'){job.state='rendering';job.progress=Math.min(94,Math.round(((job.segmentIndex+d.value/d.max)/job.totalSegments)*94));job.message=`Wan sahne ${job.segmentIndex+1}/${job.totalSegments}: ${d.value}/${d.max} adım`;}else if(msg.type==='executing'&&d.node){job.state='rendering';job.message=d.node==='9'?`Sahne ${job.segmentIndex+1}/${job.totalSegments} kareleri birleştiriliyor…`:d.node==='10'?'Video kareleri kodlanıyor…':`Wan sahne ${job.segmentIndex+1}/${job.totalSegments} üretiyor…`;}else if(msg.type==='execution_error'){job.state='error';job.error=d.exception_message||'ComfyUI üretim hatası';job.message=job.error;}}catch{}});
   ws.addEventListener('open',async()=>{job.startedAt=Date.now();queueWanSegment(job,clientId).catch(e=>{job.state='error';job.error=e.message;job.message=e.message;ws.close()})});
   ws.addEventListener('error',()=>{if(job.state==='connecting'){job.state='error';job.error='ComfyUI WebSocket bağlantısı başarısız.';job.message=job.error}});
   return send(res,202,{id:jobId,state:job.state});
  }
  if(req.method==='GET'&&req.url.startsWith('/api/ai-video?id=')){
   const id=new URL(req.url,'http://127.0.0.1').searchParams.get('id'),job=aiJobs.get(id);if(!job)return send(res,404,{error:'Üretim işi bulunamadı.'});return send(res,200,{id:job.id,state:job.state,progress:job.progress,message:job.message,file:job.file,error:job.error,seconds:job.seconds,totalSegments:job.totalSegments,segmentIndex:job.segmentIndex,provider:job.provider});
  }
  if(req.method==='POST'&&req.url==='/api/plan'){
   const b=await readBody(req);if(!b.prompt?.trim())return send(res,400,{error:'Bir video konusu yazın.'});
   const provider=b.provider==='api'?'api':'ollama',model=b.model||'qwen3.5:4b';
   const sceneCount=Math.max(3,Math.min(18,Math.round(Number(b.seconds)/5)));
   const prompt=`The user wrote this video brief in Turkish (or another language):\n${b.prompt}\n\nCreate exactly ${sceneCount} sequential scenes for a ${b.seconds}-second video. This is a faithful adaptation, not a free reinterpretation. Carefully translate the source and preserve every stated person, place, event, action, object, vehicle/transport type, color, mood, and requested detail exactly. Never substitute named objects, actions, locations, or transport types. Do not invent plot events, appearance traits, materials, weather intensity, time of day, buildings, props, destinations, or motion not in the brief. When the brief describes one continuous action, keep that action in every shot and vary only the camera framing. If a detail is unclear, describe it conservatively rather than guessing. Write ALL textual values in the JSON in natural, fluent ENGLISH, including title, heading, body, and visual. Each heading should be 2-6 words. The body should be 1-2 concise sentences describing only the requested scene/action for a video generator, not on-screen captions. The visual field must use only the details stated in the source plus a simple camera distance/angle; do not add any new nouns or actions. Return ONLY valid JSON with this schema: {"title":"short English title","scenes":[{"heading":"short English heading","body":"one or two English sentences","visual":"concrete English live-action shot description","accent":"#RRGGBB"}]}. Keep accent a valid hex color. Do not add URLs, services, or explanations.`;
   const schema={type:'object',properties:{title:{type:'string'},scenes:{type:'array',items:{type:'object',properties:{heading:{type:'string'},body:{type:'string'},visual:{type:'string'},accent:{type:'string'}},required:['heading','body','visual','accent']}}},required:['title','scenes']};
   let response;
   if(provider==='ollama')response=await fetch(OLLAMA+'/api/chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model,stream:false,think:false,format:schema,options:{temperature:0.15,num_predict:Math.min(1800,sceneCount*220)},messages:[{role:'system',content:'You are a careful bilingual film pre-production assistant. Understand Turkish source briefs accurately. Make a faithful translation into a complete scene plan in fluent natural English only. Never invent or substitute nouns, locations, transport, appearance, or actions. For one continuous action, keep the same action and vary only shot framing. The visual description may add only camera distance/angle, nothing else. Never translate output back into Turkish. Always use a valid #RRGGBB accent.'},{role:'user',content:prompt}]})});
   else {let base;try{base=new URL(b.apiBase||'')}catch{}if(!base||!['https:','http:'].includes(base.protocol)||!b.apiKey||!b.apiModel)return send(res,400,{error:'API modu için HTTPS adresi, model adı ve API anahtarı girin.'});if(base.protocol==='http:'&&!['localhost','127.0.0.1','::1'].includes(base.hostname))return send(res,400,{error:'Güvenlik için uzak API adresi HTTPS olmalı.'});response=await fetch(base.href.replace(/\/$/,'')+'/chat/completions',{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${b.apiKey}`},body:JSON.stringify({model:b.apiModel,temperature:0.25,max_tokens:Math.min(1800,sceneCount*220),response_format:{type:'json_object'},messages:[{role:'system',content:'You are a careful bilingual film pre-production assistant. Understand Turkish source briefs accurately, preserve all requested details, and return the complete scene plan in fluent natural English only. Write concrete live-action shot descriptions suitable for text-to-video generation. Return one JSON object with title and scenes; each scene needs heading, body, visual, accent. Never translate output back into Turkish.'},{role:'user',content:prompt}]})})}
   if(!response.ok)return send(res,502,{error:`${provider==='ollama'?'Ollama':'Planlama API'} yanıt vermedi (${response.status}).`});const data=await response.json();let plan;try{let content=provider==='ollama'?(data.message?.content||data.message?.thinking||''):(data.choices?.[0]?.message?.content||'');content=content.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'');plan=JSON.parse(content)}catch{return send(res,502,{error:'Model yanıt verdi ancak sahne planı JSON biçiminde değildi. Tekrar deneyin veya başka model seçin.'})};if(!Array.isArray(plan.scenes)||!plan.scenes.length)return send(res,502,{error:'Model yanıt verdi ancak sahne listesi boştu. Tekrar deneyin.'});const scenes=plan.scenes.slice(0,18).map(s=>({...s,accent:/^#[0-9a-fA-F]{6}$/.test(s.accent||'')?s.accent:'#79e5d0'}));return send(res,200,{...plan,scenes,planLanguage:'English'});
  }
  if(req.method==='POST'&&req.url==='/api/render'){
   const b=await readBody(req);if(!Array.isArray(b.scenes)||!b.scenes.length)return send(res,400,{error:'Önce sahne planı oluşturun.'});
   const seconds=Math.max(5,Math.min(180,Number(b.seconds)||30)),width=Number(b.width)||1280,height=Number(b.height)||720;
   const safe=(b.title||'yerel-video').normalize('NFKD').replace(/[^\w-]+/g,'-').replace(/^-|-$/g,'').slice(0,48)||'yerel-video';
   const dest=path.join(out,`${safe}-${Date.now()}.mp4`);const props=path.join(out,'render-props.json');fs.writeFileSync(props,JSON.stringify({title:b.title||'Yerel Video',scenes:b.scenes,seconds,width,height}));
   const entry=path.join(here,'src','index.jsx');
   const cmd=await run('node',[path.join(here,'node_modules/@remotion/cli/remotion-cli.js'),'render',entry,'LocalPromptVideo',dest,'--props',props,'--codec','h264','--crf','20'],here);
   if(!cmd.ok)return send(res,500,{error:'Render başarısız oldu. Ayrıntı: '+cmd.log});return send(res,200,{file:'/renders/'+path.basename(dest),log:cmd.log.slice(-800)});
  }
  if(req.method==='GET'&&req.url.startsWith('/renders/')){const file=path.join(out,path.basename(req.url));if(!fs.existsSync(file)){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':'video/mp4'});fs.createReadStream(file).pipe(res);return}
  const file=req.url==='/'?'index.html':path.basename(req.url);const target=path.join(here,'public',file);if(!fs.existsSync(target)){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'content-type':mime[path.extname(target)]||'application/octet-stream'});fs.createReadStream(target).pipe(res);
 }catch(e){send(res,500,{error:e.message})}
});server.listen(PORT,'127.0.0.1',()=>console.log(`Yerel Video Kolay: http://127.0.0.1:${PORT}`));

const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function cloudJson(url,options){const r=await fetch(url,{...options,signal:AbortSignal.timeout(120000)});const j=await r.json().catch(()=>({}));if(!r.ok)throw Error(j.error?.message||j.message||`Sağlayıcı HTTP ${r.status}`);return j}
async function runCloudVideoJob(job){
 try{const clipDir=path.join(here,'work','clips',job.id);fs.mkdirSync(clipDir,{recursive:true});
  for(let i=0;i<job.totalSegments;i++){
   job.segmentIndex=i;job.state='rendering';job.message=`${job.provider==='veo'?'Google Veo':'Higgsfield'} sahne ${i+1}/${job.totalSegments} gönderiliyor…`;job.progress=Math.round(i/job.totalSegments*90);
   const prompt=job.prompts[i]||job.prompts.at(-1);let mediaUrl;
   if(job.provider==='veo'){
    const model=(job.videoModel||'veo-3.1-generate-preview').replace(/[^a-zA-Z0-9._-]/g,'');const base='https://generativelanguage.googleapis.com/v1beta';
    const op=await cloudJson(`${base}/models/${model}:predictLongRunning`,{method:'POST',headers:{'content-type':'application/json','x-goog-api-key':job.apiKey},body:JSON.stringify({instances:[{prompt}],parameters:{durationSeconds:'8',aspectRatio:job.ratio,resolution:job.resolution,numberOfVideos:1}})});if(!op.name)throw Error('Google Veo işlem kimliği döndürmedi.');
    let state;for(let n=0;n<120;n++){await wait(10000);state=await cloudJson(`${base}/${op.name}`,{headers:{'x-goog-api-key':job.apiKey}});if(state.done)break;job.message=`Google Veo sahne ${i+1}/${job.totalSegments} üretiyor…`}
    if(!state?.done)throw Error('Google Veo işlemi zaman aşımına uğradı.');if(state.error)throw Error(state.error.message||'Google Veo üretim hatası.');mediaUrl=state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri||state.response?.generatedVideos?.[0]?.video?.uri;if(!mediaUrl)throw Error('Google Veo yanıtında video bağlantısı bulunamadı.');
   }else{
    const model=(job.videoModel||'wan/v2.7/text-to-video').replace(/^\/+|\/+$/g,'');if(!/^[\w./-]+$/.test(model))throw Error('Higgsfield model yolu geçersiz.');
    const queued=await cloudJson(`https://api.higgsfield.ai/${model}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Key ${job.apiKey}`},body:JSON.stringify({prompt,duration:5,resolution:job.resolution,aspect_ratio:job.ratio,prompt_extend:false,generate_audio:false})});
    const statusUrl=queued.status_url||`https://api.higgsfield.ai/requests/${queued.request_id}/status`;if(!queued.request_id&&!queued.status_url)throw Error('Higgsfield istek kimliği dönmedi.');let state;
    for(let n=0;n<180;n++){await wait(5000);state=await cloudJson(statusUrl,{headers:{authorization:`Key ${job.apiKey}`}});const status=String(state.status||'').toLowerCase();if(['completed','failed','nsfw','canceled'].includes(status))break;job.message=`Higgsfield sahne ${i+1}/${job.totalSegments} üretiyor…`}
    if(!state||!['completed'].includes(String(state.status||'').toLowerCase()))throw Error(state?.error||`Higgsfield işlemi tamamlanmadı (${state?.status||'zaman aşımı'}).`);mediaUrl=state.video?.url||state.video_url||state.output?.video?.url;if(!mediaUrl)throw Error('Higgsfield yanıtında video bağlantısı bulunamadı.');
   }
   job.message=`Sahne ${i+1}/${job.totalSegments} dosyası indiriliyor…`;const media=new URL(mediaUrl);if(media.protocol!=='https:')throw Error('Video dosyası bağlantısı güvenli HTTPS değil.');const downloaded=await fetch(media,{headers:job.provider==='veo'?{'x-goog-api-key':job.apiKey}:{},signal:AbortSignal.timeout(180000)});if(!downloaded.ok)throw Error(`Video indirilemedi (HTTP ${downloaded.status}).`);const clip=path.join(clipDir,`scene-${String(i+1).padStart(2,'0')}.mp4`);fs.writeFileSync(clip,Buffer.from(await downloaded.arrayBuffer()));job.clips.push(clip);job.progress=Math.round((job.clips.length/job.totalSegments)*90);
  }
  const list=path.join(clipDir,'concat.txt');fs.writeFileSync(list,job.clips.map(file=>`file '${file.replaceAll("'","'\\''")}'`).join('\n')+'\n');const target=path.join(out,`${job.safe}-${job.id.slice(0,8)}.mp4`);job.message='Bulut sahneleri tek MP4 içinde birleştiriliyor…';const joined=await run('ffmpeg',['-y','-f','concat','-safe','0','-i',list,'-t',String(job.seconds),'-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',target]);if(!joined.ok)throw Error(joined.log);job.file='/renders/'+path.basename(target);job.progress=100;job.state='done';job.message='Bulut video hazır ve bilgisayara indirildi.';
 }catch(e){job.state='error';job.error=e.message;job.message='Bulut video üretimi hata verdi.'}finally{job.apiKey='';job.videoModel=''}
}

function wanGraph(job){const scene=job.segmentIndex+1,prompt=job.prompts[job.segmentIndex];return{
 '1':{class_type:'UNETLoader',inputs:{unet_name:'wan2.1_t2v_1.3B_fp16.safetensors',weight_dtype:'default'}},
 '2':{class_type:'CLIPLoader',inputs:{clip_name:'umt5_xxl_fp8_e4m3fn_scaled.safetensors',type:'wan',device:'cpu'}},
 '3':{class_type:'VAELoader',inputs:{vae_name:'wan_2.1_vae.safetensors'}},
 '4':{class_type:'CLIPTextEncode',inputs:{text:`Photorealistic live-action cinematic scene. Main subject clearly visible, realistic human proportions and natural movement. ${prompt}. Natural weather, cinematic camera movement, detailed real-world environment, no text, no subtitles. Shot ${scene} of ${job.totalSegments}; maintain the same main character and clothing described in the brief.`,clip:['2',0]}},
 '5':{class_type:'CLIPTextEncode',inputs:{text:'cartoon, anime, drawing, illustration, still image, frozen frame, blurry, distorted face, bad anatomy, extra fingers, text, subtitles, watermark',clip:['2',0]}},
 '6':{class_type:'EmptyHunyuanLatentVideo',inputs:{width:832,height:480,length:Math.max(17,Math.min(161,Number(process.env.WAN_FRAMES)||81)),batch_size:1}},
 '7':{class_type:'ModelSamplingSD3',inputs:{model:['1',0],shift:8}},
 '8':{class_type:'KSampler',inputs:{model:['7',0],seed:job.seed+scene,steps:Math.max(2,Math.min(30,Number(process.env.WAN_STEPS)||20)),cfg:6,sampler_name:'uni_pc',scheduler:'simple',positive:['4',0],negative:['5',0],latent_image:['6',0],denoise:1}},
 '9':{class_type:'VAEDecode',inputs:{samples:['8',0],vae:['3',0]}},
 '10':{class_type:'SaveWEBM',inputs:{images:['9',0],filename_prefix:`VideoKolay/${job.safe}-${job.id.slice(0,8)}-scene-${scene}`,codec:'vp9',fps:16,crf:28}}
}}
async function queueWanSegment(job){job.state='queued';job.progress=Math.round((job.segmentIndex/job.totalSegments)*94);job.message=`Wan sahne ${job.segmentIndex+1}/${job.totalSegments} kuyruğa alındı…`;const r=await fetch(COMFY+'/prompt',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:wanGraph(job),client_id:job.clientId})}),data=await r.json();if(!r.ok||data.error)throw Error(JSON.stringify(data.error||data));job.comfyId=data.prompt_id;job.state='rendering';job.segmentStartedAt=Date.now();job.message=`Wan sahne ${job.segmentIndex+1}/${job.totalSegments} üretiyor…`;pollWanJob(job).catch(e=>{job.state='error';job.error=e.message;job.message='AI video üretimi hata verdi.';job.ws?.close()})}
async function pollWanJob(job){
 const root=path.join(COMFY_ROOT,'output');
 try{for(let n=0;n<10800;n++){
  if(job.state==='error')throw Error(job.error);
  const r=await fetch(COMFY+`/history/${job.comfyId}`),history=await r.json(),item=history[job.comfyId];
  if(item){if(item.status?.status_str==='error'||item.status?.completed===false)throw Error(JSON.stringify(item.status));const record=item.outputs?.['10']?.images?.[0];if(!record)throw Error('Wan tamamlandı ancak video dosyası bulunamadı.');const source=path.join(root,record.subfolder||'',record.filename);const clipDir=path.join(here,'work','clips',job.id);fs.mkdirSync(clipDir,{recursive:true});const clip=path.join(clipDir,`scene-${String(job.segmentIndex+1).padStart(2,'0')}.mp4`);job.message=`Sahne ${job.segmentIndex+1}/${job.totalSegments} MP4'e dönüştürülüyor…`;const enc=await run('ffmpeg',['-y','-i',source,'-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',clip]);if(!enc.ok)throw Error(enc.log);job.clips.push(clip);job.progress=Math.round((job.clips.length/job.totalSegments)*94);
   if(job.segmentIndex+1<job.totalSegments){job.segmentIndex++;await queueWanSegment(job);return}
   const list=path.join(clipDir,'concat.txt');fs.writeFileSync(list,job.clips.map(file=>`file '${file.replaceAll("'","'\\''")}'`).join('\n')+'\n');const target=path.join(out,`${job.safe}-${job.id.slice(0,8)}.mp4`);job.message='Tüm AI sahneleri tek MP4 içinde birleştiriliyor…';job.progress=96;const joined=await run('ffmpeg',['-y','-f','concat','-safe','0','-i',list,'-t',String(job.seconds),'-an','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p',target]);if(!joined.ok)throw Error(joined.log);job.file='/renders/'+path.basename(target);job.progress=100;job.state='done';job.message='Yerel AI video hazır.';job.ws?.close();return}
  await new Promise(resolve=>setTimeout(resolve,2000));
 }throw Error('Wan işi 6 saat içinde bitmedi.');}catch(e){job.state='error';job.error=e.message;job.message='AI video üretimi hata verdi.';job.ws?.close()}
}
