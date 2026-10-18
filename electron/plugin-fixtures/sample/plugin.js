const proof = document.querySelector('#sandbox-proof');
if (proof) {
  proof.textContent = 'Sandbox fixture loaded';
  proof.setAttribute('data-origin', location.origin);
}
