const rsvpForm = document.querySelector('#rsvp-form');
const wishForm = document.querySelector('#wish-form');
const wishStatus = document.querySelector('#wish-status');
const videoForm = document.querySelector('#video-form');
const giftReference = document.querySelector('#gift-reference');
let giftTemplate = '';
let savedRsvp;
let previousCompanionName = '';
const previousGuestNote = document.querySelector('#previous-guest-name');
const previousCompanionNote = document.querySelector('#previous-companion-name');
const guestFields = document.querySelector('#guest-fields');
const companionFields = document.querySelector('#companion-fields');
const receipt = document.querySelector('#rsvp-receipt');
const replyReminder = document.querySelector('#reply-reminder');
const receiptTitle = document.querySelector('#receipt-title');
const receiptMessage = document.querySelector('#receipt-message');
const receiptDetails = document.querySelector('#receipt-details');
const addSong = document.querySelector('#add-song');
const receiptCalendar = document.querySelector('#receipt-calendar');
const receiptVideo = document.querySelector('#receipt-video');
const dietary = document.querySelector('#dietary');
const mealPeople = document.querySelector('#meal-people');
const mealTemplate = document.querySelector('#meal-template');
const legacyMeal = document.querySelector('#legacy-meal');
const replaceLegacyMeal = document.querySelector('#replace-legacy-meal');
const people = { guest: 'Io', companion: 'Accompagnatore adulto', 'child-1': 'Bambino 1', 'child-2': 'Bambino 2' };
const mealPanels = new Map();
let previousDietary;
const rsvpStatus = document.querySelector('#rsvp-status');
const videoStatus = document.querySelector('#video-status');
const chooseVideo = document.querySelector('#choose-video');
const recordVideo = document.querySelector('#record-video');
const videoLibrary = document.querySelector('#video-library');
const videoCamera = document.querySelector('#video-camera');
const videoPicked = document.querySelector('#video-picked');
const videoPickedName = document.querySelector('#video-picked-name');
const videoPlayback = document.querySelector('#video-playback');
const removeVideo = document.querySelector('#remove-video');
const recordingPanel = document.querySelector('#recording-panel');
const recordingPreview = document.querySelector('#recording-preview');
const videoSubmit = videoForm.querySelector('button[type="submit"]');
const maxVideoBytes = 64 * 1024 * 1024;
let selectedVideo;
let playbackUrl;
let uploadId;
let recording;

function showStatus(target, message, error = false) {
  target.textContent = message;
  target.hidden = !message;
  target.toggleAttribute('data-error', error);
}

for (const [person, label] of Object.entries(people)) {
  const panel = mealTemplate.content.firstElementChild.cloneNode(true);
  panel.querySelector('summary').textContent = label;
  mealPanels.set(person, panel);
  mealPeople.append(panel);
}

function mealText(dietaryData) {
  if (!dietaryData) return '';
  const options = mealPanels.get('guest');
  const labels = (entries, group) => entries.map(entry => {
    const key = typeof entry === 'string' ? entry : entry.key;
    const option = [...options.querySelectorAll('input[name="' + group + '"]')].find(input => input.value === key);
    const label = option?.labels[0].textContent.trim() || key;
    const kind = entry.kind === 'allergy' ? 'allergia' : entry.kind === 'intolerance' ? 'intolleranza' : '';
    return kind ? label + ' (' + kind + ')' : label;
  }).join(', ');
  return [labels(dietaryData.allergens, 'allergens'), labels(dietaryData.restrictions, 'restrictions'), dietaryData.notes].filter(Boolean).join(' · ');
}

function syncMealPanels() {
  const attending = rsvpForm.elements.attendance.value === 'yes';
  const children = Number(rsvpForm.elements.children.value);
  for (const [person, panel] of mealPanels) {
    const included = person === 'guest' || (person === 'companion' && rsvpForm.elements.companion.checked) ||
      (person.startsWith('child-') && children >= Number(person.at(-1)));
    panel.hidden = !attending || !included;
    panel.querySelector('fieldset').disabled = panel.hidden;
    for (const option of panel.querySelectorAll('.meal-allergen input')) {
      const kind = option.closest('.meal-allergen').querySelector('select');
      kind.hidden = !option.checked;
      kind.disabled = !option.checked;
    }
  }
}

function collectDietary() {
  const legacy = replaceLegacyMeal.checked ? undefined : previousDietary;
  const result = { allergens: legacy?.allergens ?? [], restrictions: legacy?.restrictions ?? [], notes: legacy?.notes ?? '', people: [] };
  for (const [person, panel] of mealPanels) {
    if (panel.hidden) continue;
    const allergens = [...panel.querySelectorAll('input[name="allergens"]:checked')].map(input => ({
      key: input.value, kind: input.closest('.meal-allergen').querySelector('select').value
    }));
    const restrictions = [...panel.querySelectorAll('input[name="restrictions"]:checked')].map(input => input.value);
    const notes = panel.querySelector('textarea').value.trim();
    if (allergens.length || restrictions.length || notes) result.people.push({ person, allergens, restrictions, notes });
  }
  return result;
}

function restoreDietary(value) {
  previousDietary = value;
  replaceLegacyMeal.checked = false;
  const legacy = mealText(value);
  legacyMeal.hidden = !legacy;
  document.querySelector('#legacy-meal-text').textContent = legacy ? 'Indicazioni precedenti da assegnare: ' + legacy : '';
  const assigned = new Map((value?.people ?? []).map(person => [person.person, person]));
  for (const [person, panel] of mealPanels) {
    const saved = assigned.get(person);
    panel.open = Boolean(saved);
    const allergens = new Map((saved?.allergens ?? []).map(entry => [entry.key, entry.kind]));
    for (const input of panel.querySelectorAll('input[name="allergens"]')) {
      input.checked = allergens.has(input.value);
      input.closest('.meal-allergen').querySelector('select').value = allergens.get(input.value) ?? 'unknown';
    }
    for (const input of panel.querySelectorAll('input[name="restrictions"]')) {
      input.checked = saved?.restrictions.includes(input.value) ?? false;
    }
    panel.querySelector('textarea').value = saved?.notes ?? '';
  }
  dietary.open = Boolean(legacy || assigned.size);
  syncMealPanels();
}

function updateRsvp() {
  const attendance = rsvpForm.elements.attendance.value;
  guestFields.hidden = attendance !== 'yes';
  companionFields.hidden = guestFields.hidden || !rsvpForm.elements.companion.checked;
  rsvpForm.elements.companion.disabled = guestFields.hidden;
  rsvpForm.elements.children.disabled = guestFields.hidden;
  rsvpForm.elements.companionGivenName.disabled = companionFields.hidden;
  rsvpForm.elements.companionFamilyName.disabled = companionFields.hidden;
  rsvpForm.elements.song.disabled = guestFields.hidden;
  syncMealPanels();
  updateGiftReference();
}

async function getJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || response.redirected) {
    throw new Error(data.error || 'La richiesta non è andata a buon fine. Riprova.');
  }
  return data;
}

function addReceiptDetail(label, value) {
  const row = document.createElement('div');
  const term = document.createElement('dt');
  const definition = document.createElement('dd');
  term.textContent = label;
  definition.textContent = value;
  row.append(term, definition);
  receiptDetails.append(row);
}

function showReceipt(rsvp, focus = false) {
  savedRsvp = rsvp;
  const coming = rsvp.attendance === 'yes';
  receiptMessage.textContent = coming ? 'Ho ricevuto la tua conferma. Ti aspetto!' : 'Grazie per avermelo fatto sapere. Mi mancherai!';
  receiptDetails.replaceChildren();
  addReceiptDetail('Nome', rsvp.name);
  addReceiptDetail('Partecipazione', coming ? 'Ci sarò' : 'Non riesco a venire');

  if (coming) {
    const companion = rsvp.companionNames
      ? rsvp.companions + ' · ' + rsvp.companionNames
      : String(rsvp.companions);
    addReceiptDetail('Accompagnatori adulti', companion);
    addReceiptDetail('Bambini', String(rsvp.children));
    const legacy = mealText(rsvp.dietary);
    if (legacy) addReceiptDetail('Indicazioni da assegnare', legacy);
    for (const person of rsvp.dietary?.people ?? []) {
      const title = person.person === 'guest' ? 'Per te' : people[person.person];
      addReceiptDetail(title + ' · Cena', mealText(person));
    }
    if (rsvp.song) addReceiptDetail('Canzone', rsvp.song);
  }

  addSong.hidden = !coming || Boolean(rsvp.song);
  receiptCalendar.hidden = !coming;
  receiptVideo.hidden = coming;
  rsvpForm.hidden = true;
  replyReminder.hidden = true;
  receipt.hidden = false;
  updateGiftReference();
  if (focus) receiptTitle.focus();
}

function editResponse(field) {
  receipt.hidden = true;
  rsvpForm.hidden = false;
  updateGiftReference();
  field.focus();
}

document.querySelector('#edit-rsvp').addEventListener('click', () => {
  editResponse(rsvpForm.querySelector('input[name="attendance"]:checked') || rsvpForm.elements.givenName);
});
addSong.addEventListener('click', () => {
  editResponse(rsvpForm.elements.song);
});

rsvpForm.addEventListener('input', updateRsvp);
rsvpForm.addEventListener('change', updateRsvp);
updateRsvp();

rsvpForm.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = new FormData(rsvpForm);
  const attendance = fields.get('attendance');
  const submit = rsvpForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  showStatus(rsvpStatus, 'Invio della risposta…');

  try {
    const response = await fetch('/api/rsvp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        givenName: fields.get('givenName'),
        familyName: fields.get('familyName'),
        attendance,
        companions: fields.has('companion') ? 1 : 0,
        children: Number(fields.get('children') || 0),
        dietary: collectDietary(),
        companionGivenName: fields.get('companionGivenName') || '',
        companionFamilyName: fields.get('companionFamilyName') || '',
        companionNames: previousCompanionName,
        song: fields.get('song') || ''
      })
    });
    const { rsvp } = await getJson(response);
    previousGuestNote.hidden = true;
    if (rsvp.companionGivenName || rsvp.companionFamilyName || !rsvp.companions) {
      previousCompanionName = '';
      previousCompanionNote.hidden = true;
    }
    submit.textContent = 'Aggiorna la risposta';
    showStatus(rsvpStatus, '');
    if (!videoForm.elements.name.value) videoForm.elements.name.value = rsvp.name;
    if (!wishForm.elements.name.value) wishForm.elements.name.value = rsvp.name;
    restoreDietary(rsvp.dietary);
    showReceipt(rsvp, true);
  } catch (error) {
    showStatus(rsvpStatus, error.message, true);
  } finally {
    submit.disabled = false;
  }
});

function selectVideo(file, label) {
  if (file && (file.size === 0 || file.size > maxVideoBytes)) {
    showStatus(videoStatus, 'Scegli un video valido oppure prova con una clip più breve.', true);
    return false;
  }
  if (playbackUrl) URL.revokeObjectURL(playbackUrl);
  selectedVideo = file;
  uploadId = undefined;
  videoPicked.hidden = !file;
  if (file) {
    playbackUrl = URL.createObjectURL(file);
    videoPlayback.src = playbackUrl;
    videoPickedName.textContent = label;
  } else {
    playbackUrl = undefined;
    videoPlayback.removeAttribute('src');
    videoPlayback.load();
    videoPickedName.textContent = '';
  }
  showStatus(videoStatus, file ? 'Video pronto da inviare.' : '');
  return true;
}

function disableVideoActions(disabled) {
  for (const button of [chooseVideo, recordVideo, removeVideo, videoSubmit]) {
    button.disabled = disabled;
  }
}

chooseVideo.addEventListener('click', () => videoLibrary.click());
for (const input of [videoLibrary, videoCamera]) {
  input.addEventListener('change', () => {
    const file = input.files[0];
    input.value = '';
    if (file) selectVideo(file, input === videoCamera ? 'Video registrato' : file.name);
  });
}
removeVideo.addEventListener('click', () => {
  selectVideo(undefined);
  chooseVideo.focus();
});

function releaseRecording(session) {
  session.stream?.getTracks().forEach(track => track.stop());
  recording = undefined;
  recordingPreview.srcObject = null;
  recordingPanel.hidden = true;
  videoPicked.hidden = !selectedVideo;
  disableVideoActions(false);
}

function cancelRecording() {
  const session = recording;
  if (!session) return;
  releaseRecording(session);
  if (session.recorder?.state === 'recording') session.recorder.stop();
  showStatus(videoStatus, '');
}

recordVideo.addEventListener('click', async () => {
  if (('capture' in videoCamera && matchMedia('(pointer: coarse)').matches) ||
      !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    videoCamera.click();
    return;
  }

  const session = {};
  recording = session;
  disableVideoActions(true);
  showStatus(videoStatus, 'Attendi l’accesso a fotocamera e microfono…');
  try {
    session.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: true
    });
    if (recording !== session) {
      session.stream.getTracks().forEach(track => track.stop());
      return;
    }

    const recorder = new MediaRecorder(session.stream, { videoBitsPerSecond: 1800000 });
    session.recorder = recorder;
    const chunks = [];
    let bytes = 0;

    recorder.addEventListener('dataavailable', event => {
      if (!event.data.size) return;
      chunks.push(event.data);
      bytes += event.data.size;
      if (bytes > maxVideoBytes * .9 && recorder.state === 'recording') recorder.stop();
    });
    recorder.addEventListener('stop', () => {
      if (recording !== session) return;
      releaseRecording(session);
      const type = (recorder.mimeType || chunks[0]?.type || 'video/webm').split(';')[0];
      const extension = type === 'video/mp4' ? 'mp4' : 'webm';
      const file = new File(chunks, 'video-auguri.' + extension, { type });
      selectVideo(file, 'Video registrato');
      recordVideo.focus();
    });
    recorder.addEventListener('error', () => {
      if (recording !== session) return;
      releaseRecording(session);
      showStatus(videoStatus, 'La registrazione si è interrotta. Riprova o scegli un video dalla libreria.', true);
      recordVideo.focus();
    });
    recorder.start(1000);
    recordingPreview.srcObject = session.stream;
    recordingPanel.hidden = false;
    videoPicked.hidden = true;
    showStatus(videoStatus, 'Registrazione in corso…');
    document.querySelector('#stop-recording').focus();
  } catch {
    if (recording !== session) return;
    releaseRecording(session);
    showStatus(videoStatus, 'Fotocamera o microfono non disponibili. Puoi scegliere un video dalla libreria.', true);
    recordVideo.focus();
  }
});

document.querySelector('#stop-recording').addEventListener('click', () => {
  if (recording?.recorder?.state === 'recording') recording.recorder.stop();
});
document.querySelector('#cancel-recording').addEventListener('click', () => {
  cancelRecording();
  recordVideo.focus();
});
window.addEventListener('pagehide', cancelRecording);

function sendVideo(file, name, visibility, extension) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/video/' + uploadId);
    xhr.setRequestHeader('X-Video-Guest', encodeURIComponent(name));
    xhr.setRequestHeader('X-Video-Visibility', visibility);
    xhr.setRequestHeader('X-Video-Extension', extension);
    xhr.responseType = 'json';
    xhr.timeout = 10 * 60 * 1000;
    xhr.upload.addEventListener('progress', event => {
      if (!event.lengthComputable) return;
      const percent = Math.floor(event.loaded / event.total * 100);
      showStatus(videoStatus, percent < 100 ? 'Caricamento in corso… ' + percent + '%' : 'Salvataggio del video…');
    });
    xhr.addEventListener('load', () => {
      if (xhr.status === 201 && xhr.response?.saved) resolve();
      else if (xhr.status === 413) reject(new Error('Il video è troppo grande. Prova con una clip più breve.'));
      else reject(new Error(xhr.response?.error || 'Caricamento non riuscito. Riprova.'));
    });
    const failed = () => reject(new Error('Caricamento interrotto. Controlla la connessione e riprova.'));
    xhr.addEventListener('error', failed);
    xhr.addEventListener('timeout', failed);
    xhr.addEventListener('abort', failed);
    xhr.send(file);
  });
}

videoForm.addEventListener('submit', async event => {
  event.preventDefault();
  const file = selectedVideo;
  const name = videoForm.elements.name.value.trim();
  const visibility = videoForm.elements.visibility.value;

  if (!file || !name || !visibility) {
    showStatus(videoStatus, 'Scegli o registra un video e indica come posso usarlo prima di inviarlo.', true);
    if (!file) chooseVideo.focus();
    return;
  }

  const extension = file.name.includes('.') ? file.name.split('.').at(-1).toLowerCase() : '';
  disableVideoActions(true);
  uploadId ??= crypto.randomUUID();
  showStatus(videoStatus, 'Caricamento in corso…');
  try {
    await sendVideo(file, name, visibility, extension);
    videoForm.reset();
    videoForm.elements.name.value = name;
    selectVideo(undefined);
    showStatus(videoStatus, 'Ho ricevuto il tuo video. Grazie per aver pensato a me!');
  } catch (error) {
    showStatus(videoStatus, error.message, true);
  } finally {
    disableVideoActions(false);
  }
});

function updateGiftReference() {
  const fields = rsvpForm.elements;
  const response = rsvpForm.hidden ? savedRsvp : {
    attendance: fields.attendance.value,
    givenName: fields.givenName.value,
    companions: Number(fields.companion.checked),
    companionGivenName: fields.companionGivenName.value
  };
  const givenName = response?.attendance === 'yes' ? response.givenName?.trim() : '';
  const companion = Number(response?.companions) === 1 ? response.companionGivenName?.trim() : '';
  const names = givenName ? [givenName, companion].filter(Boolean).join(' e ') : '(NOME)';
  giftReference.textContent = giftTemplate.replace(/\{nome\}/gi, () => names);
}

for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    if (button.dataset.copy === 'reference') updateGiftReference();
    const text = button.parentElement.querySelector('span').textContent;
    const iban = button.dataset.copy === 'iban';
    const value = iban ? text.replace(/\s/g, '') : text;
    const label = iban && !document.querySelector('#gift-example').hidden
      ? 'IBAN di esempio' : button.closest('dl div').querySelector('dt').textContent;
    try {
      await navigator.clipboard.writeText(value);
      showStatus(document.querySelector('#copy-status'), label + ' · copiato');
    } catch {
      showStatus(document.querySelector('#copy-status'), 'Seleziona e copia il testo.', true);
    }
  });
}

wishForm.addEventListener('submit', async event => {
  event.preventDefault();
  const fields = new FormData(wishForm);
  const submit = wishForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await getJson(await fetch('/api/auguri', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: fields.get('name'), message: fields.get('message') })
    }));
    submit.textContent = 'Aggiorna il messaggio';
    showStatus(wishStatus, 'Ho ricevuto il tuo augurio. Grazie!');
  } catch (error) {
    showStatus(wishStatus, error.message, true);
  } finally {
    submit.disabled = false;
  }
});

async function loadInvitation() {
  try {
    const { organizer, gift, rsvp, wish } = await getJson(await fetch('/api/invito'));

    savedRsvp ??= rsvp;
    document.querySelector('#organizer-link').hidden = !organizer;
    if (wish && !wishForm.elements.message.value) {
      wishForm.elements.name.value ||= wish.name;
      wishForm.elements.message.value = wish.message;
      wishForm.querySelector('button[type="submit"]').textContent = 'Aggiorna il messaggio';
      showStatus(wishStatus, 'Il tuo augurio è salvato.');
    }
    if (gift) {
      document.querySelector('#gift-example').hidden = !gift.example;
      document.querySelector('#gift-card').hidden = false;
      for (const key of ['recipient', 'iban']) {
        const row = document.querySelector('#gift-' + key);
        row.querySelector('span').textContent = key === 'iban'
          ? (gift.iban.replace(/\s/g, '').match(/.{1,4}/g) ?? []).join(' ') : gift[key];
        row.hidden = false;
      }
      giftTemplate = gift.reference;
      updateGiftReference();
    }
    if (rsvp && !rsvpForm.elements.givenName.value && !rsvpForm.elements.familyName.value && !rsvpForm.elements.attendance.value) {
      for (const key of ['givenName', 'familyName', 'attendance', 'song', 'companionGivenName', 'companionFamilyName']) {
        rsvpForm.elements[key].value = rsvp[key] || '';
      }
      rsvpForm.elements.companion.checked = rsvp.companions > 0;
      if (!rsvp.givenName && rsvp.name) {
        previousGuestNote.textContent = 'Nome completo nella risposta precedente: ' + rsvp.name;
        previousGuestNote.hidden = false;
      }
      if (rsvp.companions === 1 && !rsvp.companionGivenName && !rsvp.companionFamilyName && rsvp.companionNames) {
        previousCompanionName = rsvp.companionNames;
        previousCompanionNote.textContent = 'Nome completo nella risposta precedente: ' + previousCompanionName;
        previousCompanionNote.hidden = false;
      }
      const children = rsvpForm.elements.children;
      if (rsvp.children > 2) {
        const option = new Option(rsvp.children + ' bambini · risposta precedente', rsvp.children);
        children.add(option);
      }
      children.value = rsvp.children;
      restoreDietary(rsvp.dietary);
      if (rsvp.companions > 1) {
        showStatus(rsvpStatus, 'La tua risposta precedente è salvata. Se la aggiorni, puoi indicare un accompagnatore adulto e gli eventuali bambini.');
      }
      if (!videoForm.elements.name.value) videoForm.elements.name.value = rsvp.name;
      if (!wishForm.elements.name.value) wishForm.elements.name.value = rsvp.name;
      rsvpForm.querySelector('button[type="submit"]').textContent = 'Aggiorna la risposta';
      updateRsvp();
      showReceipt(rsvp);
    }
  } catch {
    // The page and the forms remain available if restoring saved details fails.
  }
}

loadInvitation();

const eventTime = document.querySelector('#event-start');
const countdown = document.querySelector('#countdown');
const countdownValue = document.querySelector('#countdown-value');
const eventStart = new Date(eventTime.dateTime);
const reminderStart = new Date(replyReminder.querySelector('time').dateTime);
const deadline = document.querySelector('#rsvp-deadline time').dateTime;
const lateRsvp = document.querySelector('#late-rsvp');
const lateWish = document.querySelector('#late-wish');
const invitationHero = document.querySelector('#invito');
const dayView = document.querySelector('#event-day-view');
const dayMap = document.querySelector('#event-day-map');
const afterView = document.querySelector('#event-after-view');
const memoriesNav = document.querySelector('#memories-nav');
const invitationNav = document.querySelector('#invitation-nav');
const invitationSections = document.querySelectorAll('[data-before-event-day]');
const footerTop = document.querySelector('#footer-top');
const memoriesReel = document.querySelector('#ricordi-video');
const memoriesVideo = document.querySelector('#memories-video');
const memoriesWaiting = document.querySelector('#memories-waiting');
const memoriesPhotos = document.querySelector('#memories-photos');
const memoriesSamples = document.querySelector('#memories-samples');
const memoriesVideoLink = document.querySelector('#memories-video-link');
const memoriesPhotoLink = document.querySelector('#memories-photo-link');
let albumSignature;
const eventEnd = new Date(eventTime.dataset.end);
let nextAlbumCheck = 0;
const eventDayFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: eventTime.dataset.zone, year: 'numeric', month: '2-digit', day: '2-digit'
});

function calendarDay(date) {
  const parts = Object.fromEntries(eventDayFormat.formatToParts(date).map(({ type, value }) => [type, value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) / 86400000;
}

function renderMemories({ photos = [], video = null, samples = false }) {
  const signature = JSON.stringify({ photos, video, samples });
  if (signature === albumSignature) return;
  albumSignature = signature;

  const photoCards = photos.map(({ url, caption }, index) => {
    const card = document.createElement('figure');
    const open = document.createElement('a');
    const image = document.createElement('img');
    const footer = document.createElement('figcaption');
    const label = document.createElement('span');
    const download = document.createElement('a');
    const title = caption || 'Foto ' + (index + 1);
    open.href = url;
    open.target = '_blank';
    open.rel = 'noopener';
    image.src = url;
    image.alt = title;
    image.loading = 'lazy';
    image.decoding = 'async';
    label.textContent = title;
    download.href = url;
    download.download = '';
    download.textContent = 'Scarica';
    open.append(image);
    footer.append(label, download);
    card.append(open, footer);
    return card;
  });

  memoriesPhotos.replaceChildren(...photoCards);
  memoriesPhotos.hidden = photos.length === 0;
  memoriesWaiting.hidden = photos.length > 0;
  memoriesPhotoLink.hidden = photos.length === 0;
  memoriesSamples.hidden = !samples;
  if (video) {
    if (memoriesVideo.getAttribute('src') !== video) memoriesVideo.src = video;
    if (photos.length) memoriesVideo.poster = photos[0].url;
    else memoriesVideo.removeAttribute('poster');
  } else if (memoriesVideo.hasAttribute('src')) {
    memoriesVideo.removeAttribute('src');
    memoriesVideo.removeAttribute('poster');
    memoriesVideo.load();
  }
  memoriesReel.hidden = !video;
  memoriesVideoLink.hidden = !video;
}

function updateCountdown() {
  const now = new Date();
  if (now >= reminderStart) replyReminder.hidden = true;
  const deadlineDay = new Date(deadline + 'T12:00:00Z');
  const today = calendarDay(now);
  const eventDay = calendarDay(eventStart);
  lateWish.hidden = lateRsvp.hidden = today <= calendarDay(deadlineDay);
  const finished = now >= eventEnd;
  const isEventDay = today === eventDay && !finished;
  const invitationVisible = !isEventDay && !finished;
  dayView.hidden = !isEventDay;
  afterView.hidden = !finished;
  invitationHero.hidden = invitationNav.hidden = !invitationVisible;
  memoriesNav.hidden = !finished;
  for (const section of invitationSections) section.hidden = !invitationVisible;
  footerTop.textContent = invitationVisible ? 'Torna all’invito' : 'Torna in alto';
  if (isEventDay && !dayMap.hasAttribute('src')) dayMap.src = dayMap.dataset.src;
  if (finished && now.getTime() >= nextAlbumCheck) {
    nextAlbumCheck = now.getTime() + 5 * 60000;
    fetch('/api/foto-evento').then(getJson).then(renderMemories).catch(() => {});
  }
  const remaining = eventStart - now;
  if (!Number.isFinite(remaining) || remaining <= 0) {
    countdown.hidden = true;
    return;
  }

  const daysUntilEvent = calendarDay(eventStart) - calendarDay(now);
  const fullHours = Math.floor(remaining / 3600000);
  const days = Math.floor(fullHours / 24);
  const hours = fullHours % 24;

  if (daysUntilEvent === 0) countdownValue.textContent = 'Ci vediamo stasera!';
  else if (daysUntilEvent === 1) countdownValue.textContent = 'Domani ci vediamo!';
  else {
    const daysText = days === 1 ? 'Manca 1 giorno' : 'Mancano ' + days + ' giorni';
    const hoursText = hours > 0 ? ' e ' + hours + (hours === 1 ? ' ora' : ' ore') : '';
    countdownValue.textContent = daysText + hoursText;
  }
  countdown.hidden = false;
}

setInterval(updateCountdown, 60000);
window.addEventListener('pageshow', updateCountdown);
updateCountdown();
