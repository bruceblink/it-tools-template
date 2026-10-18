const proof = document.querySelector('#sandbox-proof');
if (proof) {
  proof.textContent = 'Sandbox fixture loaded';
  proof.setAttribute('data-origin', location.origin);
}

const runtimeProof = document.querySelector('#runtime-capability-proof');
const clipboardProof = document.querySelector('#clipboard-capability-proof');
const capabilityToast = document.querySelector('#capability-toast');
const dismissButton = document.querySelector('.dismiss');
let completedChecks = 0;

function finishCapabilityCheck(element, result, state) {
  if (!element || !capabilityToast) {
    return;
  }
  element.textContent = result;
  element.setAttribute('data-state', state);
  completedChecks += 1;
  if (completedChecks === 2) {
    capabilityToast.hidden = false;
  }
}

dismissButton?.addEventListener('click', () => {
  if (capabilityToast) {
    capabilityToast.hidden = true;
  }
});

async function requestCapability(id, capability, operation, input) {
  const response = await fetch('/__it_tools/v1/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id, capability, operation, input }),
  });
  return { status: response.status, body: await response.json() };
}

if (runtimeProof) {
  void requestCapability('runtime-info', 'runtime.info', 'read', {})
    .then(({ status, body }) => {
      const granted = status === 200 && body.ok === true;
      finishCapabilityCheck(runtimeProof, granted ? 'Available' : 'Unavailable', granted ? 'granted' : 'blocked');
    })
    .catch(() => {
      finishCapabilityCheck(runtimeProof, 'Unavailable', 'blocked');
    });
}

if (clipboardProof) {
  void requestCapability('clipboard-write', 'clipboard.write', 'writeText', { text: 'plugin proof' })
    .then(({ status, body }) => {
      const blocked = status === 403 && body.error === 'permission-denied';
      finishCapabilityCheck(clipboardProof, blocked ? 'Not authorized' : 'Unexpected response', blocked ? 'blocked' : 'unexpected');
    })
    .catch(() => {
      finishCapabilityCheck(clipboardProof, 'Unavailable', 'blocked');
    });
}
