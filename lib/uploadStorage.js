const fs=require('fs');
const path=require('path');

let cachedState;

function verifyWritable(directory,fsApi=fs){
  fsApi.mkdirSync(directory,{recursive:true});
  fsApi.accessSync(directory,fs.constants.R_OK|fs.constants.W_OK);
  const probe=path.join(directory,`.onpart-storage-${process.pid}-${Date.now()}`);
  fsApi.writeFileSync(probe,'ok',{flag:'wx'});
  fsApi.unlinkSync(probe);
}

function resolveUploadStorage({env=process.env,fsApi=fs,cwd=process.cwd()}={}){
  const production=env.NODE_ENV==='production';
  const explicit=String(env.UPLOAD_PATH||'').trim();
  let selected=explicit;
  let source=explicit?'env':'development-default';

  if(!selected&&production&&fsApi.existsSync('/disks/uploads')){
    selected='/disks/uploads';
    source='liara-disk-autodetect';
  }
  if(!selected&&production){
    throw new Error('Persistent upload storage is not configured. Set UPLOAD_PATH to the attached disk mount path.');
  }
  selected=path.resolve(selected||path.join(cwd,'uploads'));
  if(production&&!path.isAbsolute(String(explicit||selected))){
    throw new Error('UPLOAD_PATH must be an absolute path in production.');
  }
  try{verifyWritable(selected,fsApi)}catch(error){
    throw new Error(`Upload storage is not writable (${source}): ${error.message}`);
  }
  const persistence=source==='liara-disk-autodetect'||selected.replace(/\\/g,'/').startsWith('/disks/')
    ?'persistent-disk'
    :production?'explicit-unverified':'development';
  return Object.freeze({path:selected,ready:true,writable:true,source,persistence});
}

function getUploadStorage(){
  if(!cachedState){cachedState=resolveUploadStorage();process.env.UPLOAD_PATH=cachedState.path;}
  return cachedState;
}

function resetUploadStorageForTests(){cachedState=undefined;}

module.exports={resolveUploadStorage,getUploadStorage,resetUploadStorageForTests};
