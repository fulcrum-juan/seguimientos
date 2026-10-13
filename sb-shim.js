/* Capa de conexión con Supabase: login + base de datos con la misma forma que usaba la página. */
(function(){
  const SUPABASE_URL="https://ymwdrelkuqkjzrkyslge.supabase.co";
  const SUPABASE_KEY="sb_publishable_WY27xIEhql_FiG6eGrlTnw_ogd76W7w";
  const sb=window.supabase.createClient(SUPABASE_URL,SUPABASE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  window.SB=sb;

  /* ---------- base de datos (colección/documento) ---------- */
  const listeners=new Map(); // coleccion -> Set(fn)
  const docListeners=new Map(); // "coleccion|id" -> Set(fn)
  const cache=new Map(); // coleccion -> Map(id -> data)
  const snapOf=(col)=>{const m=cache.get(col)||new Map();return {docs:[...m.entries()].map(([id,data])=>({id,data:()=>data}))}};
  const docSnap=(col,id)=>{const m=cache.get(col);const d=m&&m.get(id);return {id,exists:!!d,data:()=>d}};
  function emit(col,id){
    (listeners.get(col)||[]).forEach(fn=>{try{fn(snapOf(col))}catch(e){console.error(e)}});
    (docListeners.get(col+"|"+id)||[]).forEach(fn=>{try{fn(docSnap(col,id))}catch(e){console.error(e)}});
  }
  async function load(col){
    let all=[],from=0;
    for(;;){
      const {data,error}=await sb.from("docs").select("id,data").eq("coleccion",col).range(from,from+999);
      if(error) throw error;
      all=all.concat(data); if(data.length<1000) break; from+=1000;
    }
    const m=new Map(); all.forEach(r=>m.set(r.id,r.data)); cache.set(col,m);
  }
  let channel=null;
  function ensureChannel(){
    if(channel) return;
    channel=sb.channel("docs-cambios").on("postgres_changes",{event:"*",schema:"public",table:"docs"},p=>{
      const row=p.new&&p.new.coleccion?p.new:p.old; if(!row||!row.coleccion) return;
      const col=row.coleccion; if(!cache.has(col)) return;
      const m=cache.get(col);
      if(p.eventType==="DELETE") m.delete(row.id); else m.set(row.id,p.new.data);
      emit(col,row.id);
    }).subscribe();
  }
  const loading=new Map();
  function watch(col,fn,err){
    ensureChannel();
    if(!listeners.has(col)) listeners.set(col,new Set());
    listeners.get(col).add(fn);
    if(cache.has(col)) setTimeout(()=>fn(snapOf(col)),0);
    else{
      if(!loading.has(col)) loading.set(col,load(col));
      loading.get(col).then(()=>fn(snapOf(col)),e=>{loading.delete(col);err&&err(e)});
    }
    return ()=>listeners.get(col)&&listeners.get(col).delete(fn);
  }
  function setLocal(col,id,data){ if(!cache.has(col)) cache.set(col,new Map()); if(data===null) cache.get(col).delete(id); else cache.get(col).set(id,data); emit(col,id); }
  function err(e){ const x=new Error(e.message||"error"); x.code=(e.code==="42501"||/row-level security|permission/i.test(e.message||""))?"invalid_argument":(e.code||"error"); return x; }
  function docRef(col,id){
    return {
      id,
      async set(data){ const {error}=await sb.from("docs").upsert({coleccion:col,id,data},{onConflict:"coleccion,id"}); if(error) throw err(error); setLocal(col,id,data); },
      async update(patch){
        const {error}=await sb.rpc("update_doc",{p_coleccion:col,p_id:id,p_patch:patch}); if(error) throw err(error);
        const cur=Object.assign({}, (cache.get(col)||new Map()).get(id)||{});
        for(const k of Object.keys(patch)){ const v=patch[k]; if(v&&typeof v==="object"&&v.__delete__===true) delete cur[k]; else cur[k]=v; }
        setLocal(col,id,cur);
      },
      async delete(){ const {error}=await sb.from("docs").delete().eq("coleccion",col).eq("id",id); if(error) throw err(error); setLocal(col,id,null); },
      async get(){ const {data,error}=await sb.from("docs").select("data").eq("coleccion",col).eq("id",id).maybeSingle(); if(error) throw err(error); return {id,exists:!!data,data:()=>data&&data.data}; },
      onSnapshot(fn,e){
        const k=col+"|"+id; if(!docListeners.has(k)) docListeners.set(k,new Set()); docListeners.get(k).add(fn);
        const un=watch(col,()=>{},e); setTimeout(()=>{ if(cache.has(col)) fn(docSnap(col,id)); },0);
        const t=setInterval(()=>{ if(cache.has(col)){clearInterval(t);fn(docSnap(col,id))} },200);
        return ()=>{docListeners.get(k).delete(fn);un();clearInterval(t)};
      }
    };
  }
  const db={
    collection(col){ return { doc:(id)=>docRef(col,id), onSnapshot:(fn,e)=>watch(col,fn,e) }; },
    doc(path){ const i=path.lastIndexOf("/"); return docRef(path.slice(0,i),path.slice(i+1)); }
  };

  /* ---------- usuario y rol ---------- */
  let rol=null, email="";
  const user={
    async isOwner(){return rol==="admin"}, async canEdit(){return rol==="admin"||rol==="editor"},
    async can(n){return n==="data.write"?(rol==="admin"||rol==="editor"):null},
    async me(){return {email,name:email,isOwner:rol==="admin",canEdit:rol==="admin"||rol==="editor"}}
  };

  /* ---------- puente con la página ---------- */
  let resolveReady; const ready=new Promise(r=>resolveReady=r);
  window.claude={ use: async (n)=>{ await ready; return n==="db"?db:n==="user"?user:null; } };
  window.SB_INFO={get rol(){return rol},get email(){return email}};

  /* ---------- pantalla de acceso ---------- */
  const $=id=>document.getElementById(id);
  const domReady=new Promise(r=>document.readyState!=="loading"?r():document.addEventListener("DOMContentLoaded",r));
  async function showLogin(msg,cls){ await domReady; $("login").hidden=false; $("app").hidden=true; if(msg){$("lgMsg").textContent=msg;$("lgMsg").className="lg-msg "+(cls||"")} }
  async function enter(session){
    await domReady;
    email=session.user.email||"";
    const {data,error}=await sb.rpc("mi_rol");
    rol=error?null:data;
    if(!rol){ showLogin(`La cuenta ${email} todavía no tiene acceso. Pídele al administrador que te agregue en Configuración → Usuarios.`,"bad"); $("lgOut").hidden=false; return; }
    $("login").hidden=true; $("app").hidden=false;
    $("whoami").textContent=email; $("userbar").hidden=false;
    resolveReady();
  }
  let entered=false;
  sb.auth.onAuthStateChange((ev,session)=>{
    if(ev==="PASSWORD_RECOVERY"){ domReady.then(()=>{$("login").hidden=false; $("app").hidden=true; setMode("nueva");}); return; }
    if(session&&!entered){ entered=true; enter(session); }
    if(!session&&entered){ location.reload(); }
  });
  sb.auth.getSession().then(({data})=>{ if(!data.session) showLogin(); });

  let mode="entrar";
  function setMode(m){ mode=m;
    $("lgTitle").textContent={entrar:"Entrar",crear:"Crear cuenta",olvido:"Recuperar contraseña",nueva:"Nueva contraseña"}[m];
    $("lgEmailRow").hidden=m==="nueva"; $("lgPassRow").hidden=m==="olvido";
    $("lgPass").autocomplete=m==="entrar"?"current-password":"new-password";
    $("lgBtn").textContent={entrar:"Entrar",crear:"Crear cuenta",olvido:"Enviarme un enlace",nueva:"Guardar contraseña"}[m];
    $("lgLinks").hidden=m==="nueva"; $("lgMsg").textContent="";
    document.querySelectorAll("[data-lgmode]").forEach(a=>a.hidden=a.dataset.lgmode===m);
  }
  window.addEventListener("DOMContentLoaded",()=>{
    document.querySelectorAll("[data-lgmode]").forEach(a=>a.onclick=e=>{e.preventDefault();setMode(a.dataset.lgmode)});
    $("lgOut").onclick=async()=>{await sb.auth.signOut();location.reload()};
    $("btnSalir").onclick=async()=>{await sb.auth.signOut();location.reload()};
    setMode("entrar");
    $("lgForm").addEventListener("submit",async e=>{
      e.preventDefault(); const em=$("lgEmail").value.trim(), pw=$("lgPass").value, b=$("lgBtn"); b.disabled=true; $("lgMsg").textContent="";
      try{
        if(mode==="entrar"){ const {error}=await sb.auth.signInWithPassword({email:em,password:pw}); if(error) throw error; }
        else if(mode==="crear"){ if(pw.length<8) throw {message:"La contraseña tiene que tener al menos 8 caracteres."};
          const {data,error}=await sb.auth.signUp({email:em,password:pw,options:{emailRedirectTo:location.origin+location.pathname}}); if(error) throw error;
          if(!data.session) showLogin("Listo. Te enviamos un correo para confirmar la cuenta; ábrelo y después entra con tu contraseña.","ok"); }
        else if(mode==="olvido"){ const {error}=await sb.auth.resetPasswordForEmail(em,{redirectTo:location.origin+location.pathname}); if(error) throw error; showLogin("Te enviamos un correo con el enlace para crear una contraseña nueva.","ok"); }
        else if(mode==="nueva"){ if(pw.length<8) throw {message:"La contraseña tiene que tener al menos 8 caracteres."};
          const {error}=await sb.auth.updateUser({password:pw}); if(error) throw error; location.hash=""; location.reload(); }
      }catch(x){
        const m=x.message||"";
        $("lgMsg").className="lg-msg bad";
        $("lgMsg").textContent=/Invalid login/i.test(m)?"Email o contraseña incorrectos.":/not confirmed/i.test(m)?"Todavía no confirmaste tu email: revisa tu correo.":/already registered/i.test(m)?"Ese email ya tiene cuenta: usa Entrar o Recuperar contraseña.":m||"No se pudo. Inténtalo de nuevo.";
      }finally{b.disabled=false}
    });
  });
})();
