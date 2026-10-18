const runtimeProof = document.querySelector('#runtime-proof');
const runtimePlatform = document.querySelector('#runtime-platform');
const runtimeVersion = document.querySelector('#runtime-version');
const clipboardProof = document.querySelector('#clipboard-proof');
const clipboardForm = document.querySelector('#clipboard-form');
const clipboardText = document.querySelector('#clipboard-text');
const copyButton = document.querySelector('#copy-button');
const copyResult = document.querySelector('#copy-result');

async function callCapability(id, capability, operation, input) {
  const response = await fetch('/__it_tools/v1/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, capability, operation, input }),
  });
  return { status: response.status, body: await response.json() };
}

function setCapabilityState(element, label, state) {
  element.textContent = label;
  element.dataset.state = state;
}

void callCapability('runtime-check', 'runtime.info', 'read', {})
  .then(({ status, body }) => {
    if (status !== 200 || body.ok !== true || typeof body.result !== 'object' || body.result === null) {
      setCapabilityState(runtimeProof, body.error === 'permission-denied' ? 'Not authorized' : 'Unavailable', 'blocked');
      return;
    }
    runtimePlatform.textContent = String(body.result.platform ?? 'Unknown');
    runtimeVersion.textContent = String(body.result.version ?? 'Unknown');
    setCapabilityState(runtimeProof, 'Available', 'granted');
  })
  .catch(() => setCapabilityState(runtimeProof, 'Unavailable', 'blocked'));

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
    const { status, body } = await callCapability('clipboard-copy', 'clipboard.write', 'writeText', { text });
    if (status === 200 && body.ok === true) {
      setCapabilityState(clipboardProof, 'Available', 'granted');
      copyResult.textContent = 'Text copied.';
    }
    else if (status === 403 && body.error === 'permission-denied') {
      setCapabilityState(clipboardProof, 'Not authorized', 'blocked');
      copyResult.textContent = 'Enable clipboard access in the plugin settings to copy text.';
    }
    else {
      setCapabilityState(clipboardProof, 'Unavailable', 'blocked');
      copyResult.textContent = 'The host could not copy the text.';
    }
  }
  catch {
    setCapabilityState(clipboardProof, 'Unavailable', 'blocked');
    copyResult.textContent = 'The host could not copy the text.';
  }
  finally {
    copyButton.disabled = false;
  }
});
