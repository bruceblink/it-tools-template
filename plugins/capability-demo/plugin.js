const runtimeProof = document.querySelector('#runtime-proof');
const runtimePlatform = document.querySelector('#runtime-platform');
const runtimeVersion = document.querySelector('#runtime-version');
const clipboardProof = document.querySelector('#clipboard-proof');
const clipboardForm = document.querySelector('#clipboard-form');
const clipboardText = document.querySelector('#clipboard-text');
const copyButton = document.querySelector('#copy-button');
const copyResult = document.querySelector('#copy-result');

function setCapabilityState(element, label, state) {
  element.textContent = label;
  element.dataset.state = state;
}

void window.itTools.capabilities.runtime.getInfo()
  .then((runtime) => {
    runtimePlatform.textContent = String(runtime.platform ?? 'Unknown');
    runtimeVersion.textContent = String(runtime.version ?? 'Unknown');
    setCapabilityState(runtimeProof, 'Available', 'granted');
  })
  .catch((error) => {
    const denied = error instanceof window.itTools.PluginApiError && error.code === 'permission-denied';
    setCapabilityState(runtimeProof, denied ? 'Not authorized' : 'Unavailable', 'blocked');
  });

clipboardForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  copyResult.textContent = '';
  const text = clipboardText.value;
  if (text.length === 0) {
    copyResult.textContent = 'Enter text first.';
    clipboardText.focus();
    return;
  }

  copyButton.disabled = true;
  try {
    await window.itTools.capabilities.clipboard.writeText(text);
    setCapabilityState(clipboardProof, 'Available', 'granted');
    copyResult.textContent = 'Text copied.';
  }
  catch (error) {
    const denied = error instanceof window.itTools.PluginApiError && error.code === 'permission-denied';
    setCapabilityState(clipboardProof, denied ? 'Not authorized' : 'Unavailable', 'blocked');
    copyResult.textContent = denied
      ? 'Enable clipboard access in the plugin settings to copy text.'
      : 'The host could not copy the text.';
  }
  finally {
    copyButton.disabled = false;
  }
});
