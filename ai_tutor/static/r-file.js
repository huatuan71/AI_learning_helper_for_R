/* Read local text only. The existing review API receives JSON, never a File/FormData. */
'use strict';
export class RFileInput {
  constructor({onCodeChange = () => {}} = {}) {
    this.onCodeChange = onCodeChange;
    this.$=id=>document.getElementById(id);this.sequence=0;this.pending=null;this.reading=false;this.locked=false;
    this.$('file-pick').onclick=()=>this.$('r-file').click();
    this.$('r-file').onchange=()=>{const files=[...this.$('r-file').files];this.$('r-file').value='';this.accept(files);};
    const drop=this.$('file-drop');
    drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('drag-over');});
    drop.addEventListener('dragleave',()=>drop.classList.remove('drag-over'));
    drop.addEventListener('drop',e=>{
      e.preventDefault();drop.classList.remove('drag-over');
      if([...e.dataTransfer.items].some(item=>item.webkitGetAsEntry?.()?.isDirectory)){this.feedback('不支持目录，请选择一个.R文本文件。',true);return;}
      this.accept([...e.dataTransfer.files]);
    });
    drop.addEventListener('keydown',e=>{if(e.target===drop && ['Enter',' '].includes(e.key)){e.preventDefault();this.$('file-pick').click();}});
    this.$('file-remove').onclick=()=>{this.sequence++;this.pending=null;this.reading=false;this.detach();this.feedback('已移除文件关联，编辑区代码已保留。');};
    this.$('code-clear').onclick=()=>{this.sequence++;this.pending=null;this.reading=false;this.detach();this.$('code').value='';this.onCodeChange();this.count();this.feedback();};
    this.$('code').addEventListener('input',()=>this.count());
    const dialog=this.$('replace-file-dialog');
    const cancelReplacement=()=>{
      if(this.pending)this.feedback('已取消替换，原编辑内容已保留。');
      this.pending=null;
    };
    this.$('replace-file-cancel').onclick=()=>{cancelReplacement();dialog.close();};
    dialog.addEventListener('cancel',cancelReplacement);
    this.$('replace-file-confirm').onclick=()=>{
      if(this.pending)this.apply(this.pending.file,this.pending.text);
      this.pending=null;this.$('replace-file-dialog').close();
    };
    dialog.addEventListener('close',()=>{if(!dialog.open)this.$('file-pick').focus();});
    this.count();
  }
  feedback(message='',error=false) { const n=this.$('file-feedback');n.textContent=message;n.hidden=!message;n.classList.toggle('error',error); }
  count() {
    const size=Array.from(this.$('code').value).length;
    this.$('code-count').textContent=size+' / 10000 字符';this.$('code-count').classList.toggle('error',size>10000);
    return size;
  }
  detach(){this.$('file-info').hidden=true;this.$('file-name').textContent='';this.$('file-size').textContent='';}
  apply(file,text){this.$('code').value=text;this.onCodeChange();this.$('file-name').textContent=file.name;this.$('file-size').textContent=file.size<1024?file.size+' B':(file.size/1024).toFixed(1)+' KB';this.$('file-info').hidden=false;
    this.feedback(this.count()>10000?'已读取，但超过10000字符。请精简代码后再发送。':'已在本地读取，可编辑后发送。',this.count()>10000);}
  async accept(files) {
    if(this.locked){this.feedback('正在分析，请稍后再选择文件。',true);return;}
    if(!files.length)return;
    const seq=++this.sequence;this.reading=false;
    if(files.length!==1){this.feedback('每次请选择一个.R文件。',true);return;}
    const file=files[0];
    if(!/\.r$/i.test(file.name)){this.feedback('请选择扩展名为.R或.r的文本文件。',true);return;}
    if(file.size>100*1024){this.feedback('文件超过100KB，请先精简文件。',true);return;}
    if(!file.size){this.feedback('文件为空，请选择包含R代码的文件。',true);return;}
    this.reading=true;this.feedback('正在本地读取…');
    try {
      const text=(await file.text()).replace(/^\uFEFF/,'');
      // Fatal decoding distinguishes invalid UTF-8 from a legitimate replacement character.
      const bytes=await file.arrayBuffer();
      try { new TextDecoder('utf-8',{fatal:true}).decode(bytes); }
      catch { throw new Error('UTF-8解码失败，请将文件另存为UTF-8后重试。'); }
      if(seq!==this.sequence)return;
      if(!text.trim())throw new Error('文件为空，请选择包含R代码的文件。');
      if(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text))throw new Error('检测到二进制或控制字符，请选择普通R文本文件。');
      if(this.$('code').value.trim() && this.$('code').value!==text) {
        this.pending={file,text};this.$('replace-file-message').textContent='所选文件：'+file.name;
        this.$('replace-file-dialog').showModal();this.$('replace-file-cancel').focus();
        this.feedback('文件已读取，等待确认替换。');
      } else this.apply(file,text);
    } catch(error) {
      if(seq!==this.sequence)return;
      const known=/UTF-8|文件为空|二进制/.test(error.message);
      this.feedback(known?error.message:'文件读取失败，原编辑内容已保留，请重新选择文件。',true);
    } finally {if(seq===this.sequence)this.reading=false;}
  }
}
window.RFileInput=RFileInput;
