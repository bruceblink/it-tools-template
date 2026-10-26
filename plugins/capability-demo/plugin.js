const runtimeProof = document.querySelector('#runtime-proof');
const runtimePlatform = document.querySelector('#runtime-platform');
const runtimeVersion = document.querySelector('#runtime-version');
const clipboardProof = document.querySelector('#clipboard-proof');
const clipboardForm = document.querySelector('#clipboard-form');
const clipboardText = document.querySelector('#clipboard-text');
const copyButton = document.querySelector('#copy-button');
const copyResult = document.querySelector('#copy-result');
const settingsProof = document.querySelector('#settings-proof');
const settingsForm = document.querySelector('#settings-form');
const settingsValue = document.querySelector('#settings-value');
const settingsSave = document.querySelector('#settings-save');
const settingsDelete = document.querySelector('#settings-delete');
const settingsResult = document.querySelector('#settings-result');
const settingsKey = 'demo-note';

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

void window.itTools.capabilities.settings.get(settingsKey)
  .then((value) => {
    settingsValue.value = value === undefined ? '' : String(value);
    setCapabilityState(settingsProof, 'Available', 'granted');
    settingsResult.textContent = value === undefined ? 'No saved value.' : 'Saved value loaded.';
  })
  .catch((error) => {
    const denied = error instanceof window.itTools.PluginApiError && error.code === 'permission-denied';
    setCapabilityState(settingsProof, denied ? 'Not authorized' : 'Unavailable', 'blocked');
    settingsResult.textContent = denied
      ? 'Enable settings access to save this preference.'
      : 'The host could not read the setting.';
  });

settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  settingsResult.textContent = '';
  settingsSave.disabled = true;
  try {
    await window.itTools.capabilities.settings.set(settingsKey, settingsValue.value);
    setCapabilityState(settingsProof, 'Available', 'granted');
    settingsResult.textContent = 'Setting saved.';
  }
  catch (error) {
    const denied = error instanceof window.itTools.PluginApiError && error.code === 'permission-denied';
    setCapabilityState(settingsProof, denied ? 'Not authorized' : 'Unavailable', 'blocked');
    settingsResult.textContent = denied
      ? 'Enable settings access to save this preference.'
      : 'The host could not save the setting.';
  }
  finally {
    settingsSave.disabled = false;
  }
});

settingsDelete.addEventListener('click', async () => {
  settingsDelete.disabled = true;
  settingsResult.textContent = '';
  try {
    await window.itTools.capabilities.settings.delete(settingsKey);
    settingsValue.value = '';
    setCapabilityState(settingsProof, 'Available', 'granted');
    settingsResult.textContent = 'Setting deleted.';
  }
  catch (error) {
    const denied = error instanceof window.itTools.PluginApiError && error.code === 'permission-denied';
    setCapabilityState(settingsProof, denied ? 'Not authorized' : 'Unavailable', 'blocked');
    settingsResult.textContent = denied
      ? 'Enable settings access to delete this preference.'
      : 'The host could not delete the setting.';
  }
  finally {
    settingsDelete.disabled = false;
  }
});
