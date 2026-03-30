function fwSetMsg(text, color){
  var msg=document.getElementById('fw-msg');
  if(!msg) return;
  msg.textContent=text||'';
  msg.style.color=color||'var(--text-dim)';
}

var FW_SERVICE_LABELS={
  '22/tcp':'SSH',
  '25/tcp':'SMTP',
  '80/tcp':'HTTP/Caddy',
  '443/tcp':'HTTPS/Caddy',
  '5000/tcp':'Web Editor',
  '5001/tcp':'infra-TAK Console',
  '5002/tcp':'Web Editor Alt',
  '5080/tcp':'Node-RED Flow/API',
  '8060/tcp':'ADSB Feed',
  '8061/tcp':'ADSB SUB <15k',
  '8062/tcp':'TIS-B Feed',
  '8063/tcp':'MIL Feed',
  '8064/tcp':'FIRIS Feed',
  '8089/tcp':'TAK Server TLS',
  '8322/tcp':'RTSPS',
  '8443/tcp':'TAK Server Web',
  '8446/tcp':'TAK Server Federation Web',
  '8554/tcp':'RTSP',
  '8888/tcp':'HLS',
  '8890/udp':'SRT',
  '9001/tcp':'Federation Inbound',
  '9001/udp':'Federation UDP',
  '9898/tcp':'Integration/API'
};

function fwExtractToToken(ruleLine){
  var s=(ruleLine||'').trim();
  if(!s) return '';
  var m=s.match(/^\[\s*\d+\]\s+(\S+)/);
  if(m) return m[1];
  return s.split(/\s+/)[0]||'';
}

function fwNormalizePortToken(tok){
  var t=(tok||'').toLowerCase();
  if(!t) return '';
  if(t.indexOf('/')>0) return t;
  return t+'/tcp';
}

function fwAnnotateRule(ruleLine){
  var tok=fwExtractToToken(ruleLine);
  if(!tok) return ruleLine;
  var key=fwNormalizePortToken(tok);
  var label=FW_SERVICE_LABELS[key];
  if(!label && tok.toLowerCase().endsWith('(v6)')){
    var noV6=tok.toLowerCase().replace(/\(v6\)$/,'').trim();
    label=FW_SERVICE_LABELS[fwNormalizePortToken(noV6)];
  }
  if(!label) return ruleLine;
  return ruleLine+'  ['+label+']';
}

function fwApi(url, opts){
  var o=opts||{};
  o.credentials='same-origin';
  o.redirect='manual';
  return fetch(url,o).then(function(r){
    if(r.type==='opaqueredirect' || (r.status>=300 && r.status<400)){
      throw new Error('Session expired. Refresh page and sign in again.');
    }
    return r;
  });
}

function fwRefresh(){
  var box=document.getElementById('fw-rules');
  if(box) box.textContent='Loading firewall status...';
  fwApi('/api/firewall/status')
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
        lines.push(d.rules_numbered.map(fwAnnotateRule).join(String.fromCharCode(10)));
      }else{
        lines.push('(none)');
      }
      lines.push('');
      lines.push('Standard rules:');
      if(d.rules&&d.rules.length){
        lines.push(d.rules.map(fwAnnotateRule).join(String.fromCharCode(10)));
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
  fwApi('/api/firewall/open-port',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({port:port,protocol:protocol})})
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
  fwApi('/api/firewall/close-port',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({port:port,protocol:protocol})})
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
  fwApi('/api/firewall/restrict-source',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source:source,action:act,port:port,protocol:protocol})})
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
  fwApi('/api/firewall/delete-rule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({number:num})})
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
