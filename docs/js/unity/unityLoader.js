(function(){
  const UnityLoader = {};

  UnityLoader.init = function(canvasId, buildBase){
    const canvas = document.getElementById(canvasId);
    if (!canvas){ console.error('Canvas not found:', canvasId); return Promise.reject(new Error('NO_CANVAS')); }
    if (typeof createUnityInstance !== 'function'){
      console.error('Unity loader not available');
      return Promise.reject(new Error('NO_LOADER'));
    }
    const config = {
      dataUrl: buildBase + "/Build/ScaleTrainerV2WebGL.data",
      frameworkUrl: buildBase + "/Build/ScaleTrainerV2WebGL.framework.js",
      codeUrl: buildBase + "/Build/ScaleTrainerV2WebGL.wasm",
      streamingAssetsUrl: buildBase + "/StreamingAssets",
      companyName: "GLS",
      productName: "ScaleTrainerV2WebGL",
      productVersion: "1.0"
    };
    return createUnityInstance(canvas, config).then(function(instance){
      window.unityInstance = instance;
      window.__UNITY_READY__ = true;
      canvas.focus();
      if (window.WebMidiBridge && typeof window.WebMidiBridge.setUnityInstance === 'function'){
        window.WebMidiBridge.setUnityInstance(instance);
      }
      return instance;
    });
  };

  window.UnityLoader = UnityLoader;
})();
