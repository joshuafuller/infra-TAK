function fwSetMsg(text, color){
  var msg=document.getElementById('fw-msg');
  if(!msg) return;
  msg.textContent=text||'';
  msg.style.color=color||'var(--text-dim)';
}

function fwRefresh(){
  var box=document.getElementById('fw-rules');
  if(box) box.textContent='Loading firewall status...';
  fetch('/api/firewall/status',{credentials:'same-origin'})
    .then(function(r){return r.json();})
    .then(function(d){
      if(!box) return;
      if(!d.supported){
        box.textContent=d.error||'Firewall status unavailable';
        fwSetMsg(d.error||'Unavailable','var(--yellow)');
        return;
      }
      var lines=[];
      lines.push('Status: '+(d.enabled?'active':'inactive'));
      lines.push('');
      lines.push('Numbered rules:');
      if(d.rules_numbered&&d.rules_numbered.length){
        lines.push(d.rules_numbered.join(String.fromCharCode(10)));
      }else{
        lines.push('(none)');
      }
      lines.push('');
      lines.push('Standard rules:');
      if(d.rules&&d.rules.length){
        lines.push(d.rules.join(String.fromCharCode(10)));
      }else{
        lines.push('(none)');
      }
      box.textContent=lines.join(String.fromCharCode(10));
      fwSetMsg('');
    })
    .catch(function(e){
      if(box) box.textContent='Failed to load firewall status';
      fwSetMsg(e.message||'Request failed','var(--red)');
    });
}

function fwOpenPort(){
  var p=document.getElementById('fw-port');
  var proto=document.getElementById('fw-proto');
  var btn=document.getElementById('fw-open-btn');
  var port=parseInt((p&&p.value)||'',10);
  var protocol=(proto&&proto.value)||'tcp';
  if(!port||port<1||port>65535){fwSetMsg('Enter a valid port (1-65535).','var(--red)');return;}
  if(btn) btn.disabled=true;
  fwSetMsg('Opening '+port+'/'+protocol+'...','var(--text-dim)');
  fetch('/api/firewall/open-port',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({port:port,protocol:protocol})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(btn) btn.disabled=false;
      if(!d.success){fwSetMsg(d.error||'Failed','var(--red)');return;}
      fwSetMsg(d.message||'Opened','var(--green)');
      fwRefresh();
    })
    .catch(function(e){
      if(btn) btn.disabled=false;
      fwSetMsg(e.message||'Request failed','var(--red)');
    });
}

function fwClosePort(){
  var p=document.getElementById('fw-port');
  var proto=document.getElementById('fw-proto');
  var btn=document.getElementById('fw-close-btn');
  var port=parseInt((p&&p.value)||'',10);
  var protocol=(proto&&proto.value)||'tcp';
  if(!port||port<1||port>65535){fwSetMsg('Enter a valid port (1-65535).','var(--red)');return;}
  if(!confirm('Close '+port+'/'+protocol+' inbound rule?')) return;
  if(btn) btn.disabled=true;
  fwSetMsg('Closing '+port+'/'+protocol+'...','var(--text-dim)');
  fetch('/api/firewall/close-port',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({port:port,protocol:protocol})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(btn) btn.disabled=false;
      if(!d.success){fwSetMsg(d.error||'Failed','var(--red)');return;}
      fwSetMsg(d.message||'Closed','var(--green)');
      fwRefresh();
    })
    .catch(function(e){
      if(btn) btn.disabled=false;
      fwSetMsg(e.message||'Request failed','var(--red)');
    });
}

function fwRestrictSource(){
  var src=document.getElementById('fw-src');
  var action=document.getElementById('fw-action');
  var p=document.getElementById('fw-src-port');
  var proto=document.getElementById('fw-src-proto');
  var btn=document.getElementById('fw-src-btn');
  var source=(src&&src.value||'').trim();
  var act=(action&&action.value)||'allow';
  var port=parseInt((p&&p.value)||'',10);
  var protocol=(proto&&proto.value)||'tcp';
  if(!source){fwSetMsg('Enter source IP/CIDR.','var(--red)');return;}
  if(!port||port<1||port>65535){fwSetMsg('Enter a valid port (1-65535).','var(--red)');return;}
  if(btn) btn.disabled=true;
  fwSetMsg('Applying '+act+' for '+source+' on '+port+'/'+protocol+'...','var(--text-dim)');
  fetch('/api/firewall/restrict-source',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({source:source,action:act,port:port,protocol:protocol})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(btn) btn.disabled=false;
      if(!d.success){fwSetMsg(d.error||'Failed','var(--red)');return;}
      fwSetMsg(d.message||'Applied','var(--green)');
      fwRefresh();
    })
    .catch(function(e){
      if(btn) btn.disabled=false;
      fwSetMsg(e.message||'Request failed','var(--red)');
    });
}

function fwDeleteRule(){
  var n=document.getElementById('fw-rule-num');
  var btn=document.getElementById('fw-del-btn');
  var num=parseInt((n&&n.value)||'',10);
  if(!num||num<1){fwSetMsg('Enter a valid rule number.','var(--red)');return;}
  if(!confirm('Delete firewall rule #'+num+'?')) return;
  if(btn) btn.disabled=true;
  fwSetMsg('Deleting rule #'+num+'...','var(--text-dim)');
  fetch('/api/firewall/delete-rule',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',body:JSON.stringify({number:num})})
    .then(function(r){return r.json();})
    .then(function(d){
      if(btn) btn.disabled=false;
      if(!d.success){fwSetMsg(d.error||'Failed','var(--red)');return;}
      fwSetMsg(d.message||'Deleted','var(--green)');
      fwRefresh();
    })
    .catch(function(e){
      if(btn) btn.disabled=false;
      fwSetMsg(e.message||'Request failed','var(--red)');
    });
}

fwRefresh();
