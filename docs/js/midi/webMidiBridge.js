(function(){
  const WebMidiBridge = {};

  let midiAccess = null;
  let unity = null;
  let unityReady = false;
  let pending = [];
  let debug = true;
  let activeInputId = 'all';
  let targetObjectName = 'WebGLReceiver';
  const inputsAttached = new Map(); // id -> handler

  function log(){ if (debug) console.log.apply(console, arguments); }
  function warn(){ console.warn.apply(console, arguments); }

  function sendToUnity(obj){
    const json = JSON.stringify(obj);
    if (!unity || !unityReady) {
      pending.push(json);
      log('[Queue]', json);
      return;
    }
    try {
      unity.SendMessage(targetObjectName, 'OnMIDINote', json);
      log('[JS→Unity]', json);
    } catch (err) {
      warn('SendMessage failed', err);
    }
  }

  function flushPending(){
    if (!unity || !unityReady || pending.length === 0) return;
    log('[Flush]', pending.length, 'events');
    for (const json of pending){
      try { unity.SendMessage(targetObjectName, 'OnMIDINote', json); }
      catch (err){ warn('Flush failed for', json, err); }
    }
    pending = [];
  }

  function onMIDIMessage(evt){
    const data = evt.data; // Uint8Array [status, data1, data2]
    const status = data[0];
    const type = status & 0xF0; // high nibble
    const note = data[1];
    const velOrVal = data[2] || 0;

    if (type === 0x90 && velOrVal > 0){
      // Note On
      sendToUnity({ type: 'note_on', note: note, velocity: velOrVal });
    } else if (type === 0x80 || (type === 0x90 && velOrVal === 0)){
      // Note Off
      sendToUnity({ type: 'note_off', note: note });
    } else if (type === 0xB0){
      // Control Change
      const cc = note; // data1 is controller number
      const value = velOrVal;
      if (cc === 64){
        // Sustain pedal
        sendToUnity({ type: 'cc', cc: 64, value });
      } else {
        // Forward other CCs too (optional)
        sendToUnity({ type: 'cc', cc, value });
      }
    }
  }

  function attachInput(input){
    if (!input || inputsAttached.has(input.id)) return;
    const handler = onMIDIMessage.bind(null);
    input.onmidimessage = handler;
    inputsAttached.set(input.id, handler);
    log('Attached MIDI input:', input.id, input.name || input.manufacturer);
  }

  function detachAll(){
    for (const [id] of inputsAttached){
      const inp = midiAccess && midiAccess.inputs.get(id);
      if (inp) inp.onmidimessage = null;
      inputsAttached.delete(id);
    }
  }

  WebMidiBridge.initWebMIDI = async function(){
    if (!navigator.requestMIDIAccess){
      warn('Web MIDI not supported');
      throw new Error('WEB_MIDI_UNSUPPORTED');
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      log('Web MIDI enabled');
      // Attach to inputs based on selection
      attachBasedOnSelection();
      // Hot-plug support
      midiAccess.onstatechange = function(e){
        const port = e.port;
        if (port.type === 'input' && port.state === 'connected'){
          log('MIDI device connected:', port.id, port.name);
          if (activeInputId === 'all' || activeInputId === port.id){
            const inp = midiAccess.inputs.get(port.id);
            attachInput(inp);
          }
        }
        if (port.type === 'input' && port.state === 'disconnected'){
          log('MIDI device disconnected:', port.id, port.name);
          const inp = midiAccess.inputs.get(port.id);
          if (inp) inp.onmidimessage = null;
          inputsAttached.delete(port.id);
        }
      };
      return true;
    } catch (err){
      warn('Web MIDI init error', err);
      throw err;
    }
  };

  function attachBasedOnSelection(){
    if (!midiAccess) return;
    detachAll();
    if (activeInputId === 'all'){
      for (const input of midiAccess.inputs.values()){
        attachInput(input);
      }
    } else {
      const input = midiAccess.inputs.get(activeInputId);
      if (input) attachInput(input);
      else warn('Selected input not found:', activeInputId);
    }
  }

  WebMidiBridge.getInputs = function(){
    if (!midiAccess) return [];
    const list = [];
    for (const input of midiAccess.inputs.values()){
      list.push({ id: input.id, name: input.name, manufacturer: input.manufacturer });
    }
    log('Inputs:', list);
    return list;
  };

  WebMidiBridge.selectInput = function(id){
    activeInputId = id || 'all';
    attachBasedOnSelection();
  };

  WebMidiBridge.setUnityInstance = function(instance){
    unity = instance;
    unityReady = true;
    flushPending();
  };

  WebMidiBridge.setTargetObjectName = function(name){
    if (typeof name === 'string' && name.trim().length > 0){
      targetObjectName = name.trim();
      log('Unity target object set to:', targetObjectName);
    }
  };

  WebMidiBridge.setDebug = function(enabled){
    debug = !!enabled;
  };

  Object.defineProperty(WebMidiBridge, 'activeInputId', { get(){ return activeInputId; } });
  Object.defineProperty(WebMidiBridge, 'targetObjectName', { get(){ return targetObjectName; } });

  window.WebMidiBridge = WebMidiBridge;
})();
