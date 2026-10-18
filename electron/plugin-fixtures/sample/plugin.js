const proof = document.querySelector('#sandbox-proof');
if (proof) {
  proof.textContent = 'Sandbox fixture loaded';
  proof.setAttribute('data-origin', location.origin);
}

const runtimeProof = document.querySelector('#runtime-capability-proof');
const clipboardProof = document.querySelector('#clipboard-capability-proof');

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
      runtimeProof.textContent = status === 200 && body.ok === true
        ? 'Runtime capability granted'
        : `Runtime capability denied: ${status} ${body.error ?? 'unknown'}`;
    })
    .catch(() => {
      runtimeProof.textContent = 'Runtime capability unavailable';
    });
}

if (clipboardProof) {
  void requestCapability('clipboard-write', 'clipboard.write', 'writeText', { text: 'plugin proof' })
    .then(({ status, body }) => {
      clipboardProof.textContent = status === 403 && body.error === 'permission-denied'
        ? 'Clipboard capability denied'
        : 'Clipboard capability response unexpected';
    })
    .catch(() => {
      clipboardProof.textContent = 'Clipboard capability unavailable';
    });
}
