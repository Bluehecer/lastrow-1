import { firebaseConfig } from './firebase-config.js';
import { cloudinaryConfig } from './cloudinary-config.js';
import { escapeDate, validatePublishingDate } from './admin-validation.mjs';
import { deletePublishedContent } from './admin-delete.mjs';
import { publishRecordWithOptionalMedia } from './admin-publish.mjs';
import { uploadMediaToCloudinary } from './cloudinary-upload.mjs';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  addDoc, collection, deleteDoc, deleteField, doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  deleteObject, getStorage, ref
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';

const hasFirebaseConfig = firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR_');
let db;
let auth;
let storage;
let events = [];
let contentUnsubscribes = [];
let approvalUnsubscribe;

const $ = (selector, root = document) => root.querySelector(selector);

function showStatus(message, isError = false) {
  const status = $('#adminStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('is-error', isError);
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatDate(value, options = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!escapeDate(value)) return '';
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, options).format(new Date(year, month - 1, day));
}

function localDateKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addMedia(parent, item, className = 'content-media') {
  if (!item.mediaUrl) return;
  const media = item.mediaType && item.mediaType.startsWith('video/')
    ? document.createElement('video')
    : document.createElement('img');
  media.className = className;
  if (media instanceof HTMLVideoElement) {
    media.controls = true;
    media.preload = 'metadata';
  } else {
    media.alt = item.title || 'Last Row photo';
    media.loading = 'lazy';
  }
  media.src = item.mediaUrl;
  parent.append(media);
}

function renderEventCard(item) {
  const card = element('article', 'event-card');
  const date = element('div', 'event-date');
  date.append(element('span', 'event-month', formatDate(item.date, { month: 'short' }).toUpperCase()));
  date.append(element('strong', '', formatDate(item.date, { day: '2-digit' })));
  const copy = element('div', 'event-copy');
  copy.append(element('span', 'event-tag', item.time || 'A day with the crew'));
  copy.append(element('h3', '', item.title));
  copy.append(element('p', '', item.description || ''));
  if (item.location) copy.append(element('span', 'event-location', `⌖ ${item.location}`));
  card.append(date, copy);
  addMedia(card, item, 'event-media');
  return card;
}

function renderNewsCard(item) {
  const card = element('article', 'news-card');
  addMedia(card, item, 'news-media');
  const copy = element('div', 'news-copy');
  copy.append(element('span', 'event-tag', formatDate(item.date)));
  copy.append(element('h3', '', item.title));
  copy.append(element('p', '', item.body || item.description || ''));
  card.append(copy);
  return card;
}

function renderProduct(item) {
  const card = element('article', 'product-card');
  const visual = element('div', 'product-visual');
  addMedia(visual, item, 'product-media');
  if (!item.mediaUrl) visual.append(element('span', 'product-placeholder', 'LR'));
  card.append(visual);
  const copy = element('div', 'product-copy');
  const row = element('div', 'product-heading');
  row.append(element('h3', '', item.title));
  row.append(element('span', 'product-price', `${Number(item.price).toFixed(2)}`));
  copy.append(row, element('p', '', item.description || ''));
  card.append(copy);
  return card;
}

function renderCrewMember(item) {
  const card = element('article', 'crew-card');
  const avatar = element('div', 'crew-avatar avatar-coral');
  if (item.mediaUrl) {
    const image = element('img', 'crew-photo');
    image.src = item.mediaUrl;
    image.alt = item.name;
    image.loading = 'lazy';
    avatar.append(image);
  } else {
    avatar.textContent = (item.name || '?').trim().charAt(0).toUpperCase();
  }
  card.append(
    avatar,
    element('span', 'crew-role', item.role || 'Crew'),
    element('h2', '', item.name || ''),
    element('p', '', item.bio || '')
  );
  return card;
}

function setCards(selector, items, renderer, emptyText, limit) {
  const container = $(selector);
  if (!container) return;
  container.replaceChildren();
  if (!items.length) {
    container.append(element('p', 'empty-state', emptyText));
    return;
  }
  items.slice(0, limit || items.length).forEach((item) => container.append(renderer(item)));
}

function updateCalendar() {
  const calendar = $('#calendarDays');
  const title = $('#calendarTitle');
  if (!calendar || !title) return;
  const month = window.calendarMonth;
  title.textContent = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month);
  calendar.replaceChildren();
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const firstDay = (new Date(year, monthIndex, 1).getDay() + 6) % 7;
  const daysCount = new Date(year, monthIndex + 1, 0).getDate();
  const today = new Date();
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  for (let i = 0; i < firstDay; i++) calendar.append(element('span', 'calendar-blank'));
  for (let day = 1; day <= daysCount; day++) {
    const key = `${year}-${String(monthIndex + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const matching = events.filter((event) => event.date === key);
    const button = element('button', 'calendar-day', String(day));
    button.type = 'button';
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `${formatDate(key, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}${matching.length ? `, ${matching.length} event${matching.length === 1 ? '' : 's'}` : ''}`);
    if (matching.length) button.classList.add('has-event');
    if (key === todayKey) button.classList.add('is-today');
    button.addEventListener('click', () => selectCalendarDate(key));
    calendar.append(button);
  }
}

function selectCalendarDate(key) {
  const heading = $('#selectedDateTitle');
  const list = $('#selectedDateEvents');
  if (!heading || !list) return;
  heading.textContent = formatDate(key, { weekday: 'long', month: 'long', day: 'numeric' });
  list.replaceChildren();
  const matches = events.filter((event) => event.date === key);
  if (!matches.length) {
    list.append(element('p', 'muted-copy', 'No plans yet for this date. A perfect day to make some.'));
    return;
  }
  matches.forEach((event) => list.append(renderEventCard(event)));
}

function renderManageList(collectionName, items, target) {
  const list = $(target);
  if (!list) return;
  list.replaceChildren();
  if (!items.length) {
    list.append(element('p', 'muted-copy', 'Nothing published yet.'));
    return;
  }
  items.forEach((item) => {
    const row = element('div', 'manage-row');
    row.append(element('span', '', item.title));
    const actions = element('div', 'manage-actions');
    const edit = element('button', 'delete-button manage-edit', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => beginContentEdit(collectionName, item));
    actions.append(edit);
    const button = element('button', 'delete-button', 'Delete');
    button.type = 'button';
    button.addEventListener('click', async () => {
      if (!window.confirm(`Delete “${item.title}” from the site?`)) return;
      button.disabled = true;
      try {
        const cleanupError = await deletePublishedContent(
          () => deleteDoc(doc(db, collectionName, item.id)),
          item.mediaPath,
          (mediaPath) => deleteObject(ref(storage, mediaPath))
        );
        if (cleanupError) {
          console.error('Published content was deleted, but its media could not be cleaned up:', cleanupError);
          showStatus(`“${item.title}” was deleted, but its image or video could not be cleaned up: ${cleanupError.message}`, true);
          return;
        }
        showStatus('Content removed.');
      } catch (error) {
        button.disabled = false;
        showStatus(`Could not delete content: ${error.message}`, true);
      }
    });
    actions.append(button);
    row.append(actions);
    list.append(row);
  });
}

function beginContentEdit(collectionName, item) {
  const formIds = { events: 'eventForm', news: 'newsForm', products: 'productForm' };
  const titleIds = { events: 'eventFormTitle', news: 'newsFormTitle', products: 'productFormTitle' };
  const buttonLabels = { events: 'Save event', news: 'Save update', products: 'Save product' };
  const form = $(`#${formIds[collectionName]}`);
  if (!form) return;

  form.reset();
  form.elements.namedItem('recordId').value = item.id;
  Object.entries(item).forEach(([name, value]) => {
    const field = form.elements.namedItem(name);
    if (field && typeof value !== 'object' && name !== 'id') field.value = value ?? '';
  });
  $(`#${titleIds[collectionName]}`).textContent = `Edit ${item.title}`;
  $('button[type="submit"]', form).textContent = buttonLabels[collectionName];
  $('.cancel-content-edit', form).hidden = false;
  $('.publish-feedback', form).hidden = true;
  form.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function resetContentForm(form, defaultTitle, defaultButton) {
  form.reset();
  form.elements.namedItem('recordId').value = '';
  $(`#${form.id}Title`).textContent = defaultTitle;
  $('button[type="submit"]', form).textContent = defaultButton;
  $('.cancel-content-edit', form).hidden = true;
  const feedback = $('.publish-feedback', form);
  feedback.hidden = true;
  feedback.textContent = '';
  feedback.dataset.state = '';
}

function renderCrewManageList(items) {
  const list = $('#manageCrew');
  if (!list) return;
  list.replaceChildren();
  if (!items.length) {
    list.append(element('p', 'muted-copy', 'No crew members added yet.'));
    return;
  }
  items.forEach((item) => {
    const row = element('div', 'manage-row');
    row.append(element('span', '', `${item.name} · ${item.role || 'Crew'}`));
    const actions = element('div', 'manage-actions');
    const edit = element('button', 'delete-button', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      const form = $('#crewForm');
      form.elements.namedItem('memberId').value = item.id;
      form.elements.namedItem('name').value = item.name || '';
      form.elements.namedItem('role').value = item.role || '';
      form.elements.namedItem('bio').value = item.bio || '';
      form.elements.namedItem('position').value = item.position ?? 0;
      $('#crewFormTitle').textContent = `Edit ${item.name}`;
      $('#saveCrewButton').textContent = 'Save changes';
      $('#cancelCrewEdit').hidden = false;
      form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    const remove = element('button', 'delete-button', 'Remove');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!window.confirm(`Remove ${item.name} from the crew page?`)) return;
      remove.disabled = true;
      try {
        await deleteDoc(doc(db, 'crew', item.id));
        if (item.mediaPath) {
          try {
            await deleteObject(ref(storage, item.mediaPath));
          } catch (error) {
            console.error('Crew profile removed, but its photo could not be deleted:', error);
            showStatus(`${item.name} was removed, but the old photo could not be cleaned up: ${error.message}`, true);
            return;
          }
        }
        showStatus(`${item.name} removed from the crew page.`);
      } catch (error) {
        remove.disabled = false;
        showStatus(`Could not remove crew member: ${error.message}`, true);
      }
    });
    actions.append(edit, remove);
    row.append(actions);
    list.append(row);
  });
}

function resetCrewForm() {
  const form = $('#crewForm');
  if (!form) return;
  form.reset();
  form.elements.namedItem('memberId').value = '';
  $('#crewFormTitle').textContent = 'Add a crew member';
  $('#saveCrewButton').textContent = 'Add to the crew';
  $('#cancelCrewEdit').hidden = true;
}

function setupCrewForm() {
  const form = $('#crewForm');
  if (!form) return;
  $('#cancelCrewEdit').addEventListener('click', resetCrewForm);
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const user = auth.currentUser;
    if (!user) {
      showStatus('Sign in again before editing the crew.', true);
      return;
    }
    const data = new FormData(form);
    const name = String(data.get('name') || '').trim();
    const role = String(data.get('role') || '').trim();
    const bio = String(data.get('bio') || '').trim();
    const position = Number(data.get('position'));
    const memberId = String(data.get('memberId') || '');
    const file = data.get('media');
    const imageFile = file instanceof File && file.size ? file : null;
    const submit = $('#saveCrewButton');
    submit.disabled = true;
    let uploaded;
    let oldMediaPath;
    let profileSaved = false;
    showStatus(memberId ? 'Saving crew changes…' : 'Adding crew member…');
    try {
      if (!name || !role || !bio) throw new Error('Add a name, role, and short bio.');
      if (!Number.isInteger(position) || position < 0) throw new Error('Display order must be a whole number of zero or more.');
      if (imageFile && !imageFile.type.startsWith('image/')) throw new Error('Choose an image for the crew photo.');

      const payload = { name, role, bio, position, updatedAt: serverTimestamp() };
      if (memberId) {
        const memberRef = doc(db, 'crew', memberId);
        const existing = await getDoc(memberRef);
        if (!existing.exists()) throw new Error('That crew profile no longer exists. Refresh the page and try again.');
        oldMediaPath = existing.data().mediaPath;
        if (imageFile) {
          showStatus('Uploading crew photo to Cloudinary…');
          uploaded = await uploadMedia(imageFile);
          payload.mediaPath = deleteField();
        }
        if (uploaded) Object.assign(payload, uploaded);
        await updateDoc(memberRef, payload);
        profileSaved = true;
        if (uploaded && oldMediaPath) {
          try {
            await deleteObject(ref(storage, oldMediaPath));
          } catch (error) {
            console.error('Crew profile updated, but its previous photo could not be deleted:', error);
            showStatus(`${name}'s profile was updated, but the previous photo could not be cleaned up: ${error.message}`, true);
            resetCrewForm();
            return;
          }
        }
        showStatus(`${name}'s crew profile updated.`);
      } else {
        if (imageFile) {
          showStatus('Uploading crew photo to Cloudinary…');
          uploaded = await uploadMedia(imageFile);
        }
        if (uploaded) Object.assign(payload, uploaded);
        payload.createdAt = serverTimestamp();
        payload.createdBy = user.uid;
        await addDoc(collection(db, 'crew'), payload);
        profileSaved = true;
        showStatus(`${name} added to the crew page.`);
      }
      resetCrewForm();
    } catch (error) {
      if (!profileSaved && uploaded && uploaded.mediaPath) {
        try {
          await deleteObject(ref(storage, uploaded.mediaPath));
        } catch (cleanupError) {
          console.error('Could not clean up a crew photo upload:', cleanupError);
        }
      }
      const orphanNote = uploaded && !uploaded.mediaPath
        ? ' The photo was uploaded to Cloudinary but could not be attached; remove it from Cloudinary if you do not need it.'
        : '';
      showStatus(`Could not save crew profile: ${error.message}.${orphanNote}`, true);
    } finally {
      submit.disabled = false;
    }
  });
}

function subscribeToApprovals() {
  if (approvalUnsubscribe) return;
  approvalUnsubscribe = onSnapshot(collection(db, 'adminRequests'), (snapshot) => {
    const container = $('#pendingApprovals');
    if (!container) return;
    container.replaceChildren();
    if (snapshot.empty) {
      container.append(element('p', 'muted-copy', 'No pending access requests.'));
      return;
    }
    snapshot.docs.forEach((entry) => {
      const request = entry.data();
      if (request.approved === true) return;
      const row = element('div', 'approval-row');
      const details = element('div', 'approval-details');
      details.append(element('strong', '', request.email || 'Unknown email'));
      details.append(element('small', '', `Account ID: ${entry.id}`));
      const button = element('button', 'btn btn-primary approval-button', 'Approve');
      button.type = 'button';
      button.addEventListener('click', async () => {
        button.disabled = true;
        try {
          await updateDoc(doc(db, 'adminRequests', entry.id), { approved: true });
          showStatus(`Admin access approved for ${request.email || entry.id}. They should refresh the portal.`);
        } catch (error) {
          button.disabled = false;
          showStatus(`Could not approve account: ${error.message}`, true);
        }
      });
      row.append(details, button);
      container.append(row);
    });
  }, (error) => {
    console.error('Could not load access requests:', error);
    const container = $('#pendingApprovals');
    if (container) container.replaceChildren(element('p', 'muted-copy', `Could not load requests: ${error.message}`));
  });
}

function stopApprovalSubscription() {
  if (approvalUnsubscribe) approvalUnsubscribe();
  approvalUnsubscribe = undefined;
}

async function sendAccessRequest(user) {
  const requestRef = doc(db, 'adminRequests', user.uid);
  const existing = await getDoc(requestRef);
  if (!existing.exists()) {
    await setDoc(requestRef, {
      uid: user.uid,
      email: user.email || '',
      approved: false,
      requestedAt: serverTimestamp()
    });
  }
  $('#accessHeading').textContent = 'Request sent.';
  $('#accessMessage').textContent = 'Your request is waiting for an existing admin to approve it. Sign in again after they approve your access.';
  $('#requestAccessButton').hidden = true;
}

function subscribeToContent() {
  if (contentUnsubscribes.length) return;
  const collections = ['events', 'news', 'products', 'crew'];
  collections.forEach((name) => {
    const unsubscribe = onSnapshot(collection(db, name), (snapshot) => {
      const items = snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
      items.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      if (name === 'events') {
        events = items;
        setCards('#homeEvents', items.filter((item) => item.date >= localDateKey()), renderEventCard, 'No plans posted just yet. Check back soon.', 3);
        setCards('#allEvents', items.filter((item) => item.date >= localDateKey()), renderEventCard, 'No upcoming plans just yet. Check back soon.');
        updateCalendar();
        renderManageList(name, items, '#manageEvents');
      } else if (name === 'news') {
        const recent = [...items].sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        setCards('#homeNews', recent, renderNewsCard, 'No updates yet. The next good story will show up here.', 2);
        setCards('#allNews', recent, renderNewsCard, 'No updates yet. The next good story will show up here.');
        renderManageList(name, items, '#manageNews');
      } else if (name === 'products') {
        setCards('#products', items, renderProduct, 'The shop is having a quiet moment. Check back soon.');
        renderManageList(name, items, '#manageProducts');
      } else {
        const crew = [...items].sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.name || '').localeCompare(b.name || ''));
        setCards('#crewMembers', crew, renderCrewMember, 'No crew profiles yet. The admins can add everyone from the admin studio.');
        renderCrewManageList(crew);
      }
    }, (error) => {
      console.error(`Could not load ${name}:`, error);
      const selectors = name === 'events'
        ? ['#homeEvents', '#allEvents']
        : name === 'news'
          ? ['#homeNews', '#allNews']
          : name === 'products'
            ? ['#products']
            : ['#crewMembers'];
      selectors
        .forEach((selector) => {
          const container = $(selector);
          if (container) container.replaceChildren(element('p', 'empty-state', `Could not load ${name}. Please try again later.`));
        });
      if (name === 'crew') {
        const list = $('#manageCrew');
        if (list) list.replaceChildren(element('p', 'muted-copy', `Could not load crew profiles: ${error.message}`));
      }
      if (name === 'events') {
        const selected = $('#selectedDateEvents');
        if (selected) selected.replaceChildren(element('p', 'muted-copy', 'Could not load calendar events.'));
      }
    });
    contentUnsubscribes.push(unsubscribe);
  });
}

function stopContentSubscriptions() {
  contentUnsubscribes.forEach((unsubscribe) => unsubscribe());
  contentUnsubscribes = [];
}

async function uploadMedia(file) {
  return uploadMediaToCloudinary(file, cloudinaryConfig);
}

function setupAdmin() {
  const loginForm = $('#loginForm');
  const loginPanel = $('#loginPanel');
  const dashboard = $('#adminDashboard');
  const accessPanel = $('#accessPanel');
  if (!loginPanel || !dashboard) return;
  if (!hasFirebaseConfig) {
    showStatus('Firebase is not configured yet. Add your project settings to firebase-config.js.', true);
    return;
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(loginForm);
    const submit = $('button[type="submit"]', loginForm);
    submit.disabled = true;
    showStatus('Signing in…');
    try {
      await signInWithEmailAndPassword(auth, String(data.get('email')), String(data.get('password')));
    } catch (error) {
      showStatus(`Sign in failed: ${error.message}`, true);
    } finally {
      submit.disabled = false;
    }
  });
  $('#createAccountButton').addEventListener('click', async () => {
    const data = new FormData(loginForm);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    if (!email || !password) {
      showStatus('Enter your email and password first, then choose Create account.', true);
      loginForm.reportValidity();
      return;
    }
    const button = $('#createAccountButton');
    button.disabled = true;
    showStatus('Creating your account…');
    try {
      const credential = await createUserWithEmailAndPassword(auth, email, password);
      await sendAccessRequest(credential.user);
      showStatus('Account created. Your access request is waiting for approval.');
    } catch (error) {
      showStatus(`Could not create account: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
  $('#requestAccessButton').addEventListener('click', async () => {
    const user = auth.currentUser;
    if (!user) {
      showStatus('Sign in before requesting access.', true);
      return;
    }
    const button = $('#requestAccessButton');
    button.disabled = true;
    try {
      await sendAccessRequest(user);
      showStatus('Access request sent.');
    } catch (error) {
      showStatus(`Could not send access request: ${error.message}`, true);
    } finally {
      button.disabled = false;
    }
  });
  $('#logoutButton').addEventListener('click', () => signOut(auth).catch((error) => showStatus(`Could not sign out: ${error.message}`, true)));
  $('#accessLogoutButton').addEventListener('click', () => signOut(auth).catch((error) => showStatus(`Could not sign out: ${error.message}`, true)));
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      stopContentSubscriptions();
      stopApprovalSubscription();
      loginPanel.hidden = false;
      accessPanel.hidden = true;
      dashboard.hidden = true;
      showStatus('Sign in with your admin account.');
      return;
    }
    try {
      const accessRequest = await getDoc(doc(db, 'adminRequests', user.uid));
      const hasAdminAccess = accessRequest.exists() && accessRequest.data().approved === true;
      loginPanel.hidden = true;
      if (!hasAdminAccess) {
        stopContentSubscriptions();
        stopApprovalSubscription();
        dashboard.hidden = true;
        accessPanel.hidden = false;
        $('#accessHeading').textContent = accessRequest.exists() ? 'Request pending.' : 'Request portal access.';
        $('#accessMessage').textContent = accessRequest.exists()
          ? 'An admin still needs to approve your request. You can sign out and check back later.'
          : 'Your account is signed in. Send an access request to an existing admin. They can approve it here.';
        $('#requestAccessButton').hidden = accessRequest.exists();
        showStatus(accessRequest.exists() ? 'Access request is waiting for approval.' : 'Account signed in. Request access to use the portal.');
        return;
      }
      accessPanel.hidden = true;
      dashboard.hidden = false;
      showStatus(`Signed in as ${user.email}.`);
      subscribeToContent();
      subscribeToApprovals();
    } catch (error) {
      showStatus(`Could not verify admin access: ${error.message}`, true);
    }
  });
  setupCrewForm();

  [
    { id: 'eventForm', collectionName: 'events', fields: ['title', 'date', 'time', 'location', 'description'], title: 'Add an event', button: 'Publish event ↗', success: 'Event' },
    { id: 'newsForm', collectionName: 'news', fields: ['title', 'date', 'body'], title: 'Post an update', button: 'Share update ↗', success: 'Update' },
    { id: 'productForm', collectionName: 'products', fields: ['title', 'price', 'description'], title: 'Add a product', button: 'Add to store ↗', success: 'Product' }
  ].forEach((formConfig) => {
    const { id, collectionName, fields } = formConfig;
    const form = $(`#${id}`);
    const defaultSubmitContent = $('button[type="submit"]', form).innerHTML;
    const cancelButton = $('.cancel-content-edit', form);
    cancelButton.addEventListener('click', () => resetContentForm(form, formConfig.title, formConfig.button));
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const submit = $('button[type="submit"]', form);
      const feedback = $('.publish-feedback', form);
      const user = auth.currentUser;
      if (!user) {
        if (feedback) {
          feedback.hidden = false;
          feedback.dataset.state = 'error';
          feedback.textContent = 'Sign in again before publishing.';
        }
        showStatus('Sign in again before publishing.', true);
        return;
      }
      const formData = new FormData(form);
      const recordId = String(formData.get('recordId') || '');
      const submitContent = submit.innerHTML;
      submit.disabled = true;
      cancelButton.disabled = true;
      submit.classList.add('is-publishing');
      submit.innerHTML = '<span class="publish-spinner" aria-hidden="true"></span> Publishing…';
      if (feedback) {
        feedback.hidden = false;
        feedback.dataset.state = 'pending';
        feedback.textContent = recordId ? `Updating ${formConfig.success.toLowerCase()}…` : collectionName === 'products' ? 'Publishing product to the store…' : 'Publishing to the site…';
      }
      showStatus(recordId ? `Updating ${formConfig.success.toLowerCase()}…` : collectionName === 'products' ? 'Publishing product to the store…' : 'Publishing…');
      let publishingStage = recordId ? 'updating content' : 'publishing';
      const slowPublishTimer = window.setTimeout(() => {
        const message = `Still ${publishingStage}—this is taking longer than expected. Keep this page open and don’t click again yet.`;
        if (feedback) feedback.textContent = message;
        showStatus(message);
      }, 20000);
      let mediaUploaded = false;
      let previousMedia;
      let mediaCleanupError;
      try {
        const date = String(formData.get('date') || '');
        validatePublishingDate(collectionName, date);
        const payload = Object.fromEntries(fields.map((field) => [field, String(formData.get(field) || '').trim()]));
        if (collectionName === 'products') payload.price = Number(formData.get('price'));
        if (collectionName === 'products' && (!Number.isFinite(payload.price) || payload.price < 0)) throw new Error('Enter a valid price.');
        const file = formData.get('media');
        const mediaFile = file instanceof File && file.size ? file : null;
        if (recordId && mediaFile) {
          const existing = await getDoc(doc(db, collectionName, recordId));
          if (!existing.exists()) throw new Error('That item no longer exists. Refresh the page and try again.');
          previousMedia = existing.data();
        }
        publishingStage = recordId ? 'saving your changes' : collectionName === 'products' ? 'saving your product' : 'saving your post';
        const savingMessage = recordId
          ? 'Saving your changes…'
          : collectionName === 'products'
            ? 'Saving product to the store…'
            : 'Saving to the site…';
        await publishRecordWithOptionalMedia(
          (media) => {
            publishingStage = recordId ? 'saving your changes' : collectionName === 'products' ? 'saving your product' : 'saving your post';
            if (feedback) feedback.textContent = savingMessage;
            showStatus(savingMessage);
            const recordData = { ...payload, ...media, updatedAt: serverTimestamp() };
            if (recordId) {
              if (mediaFile) recordData.mediaPath = deleteField();
              return updateDoc(doc(db, collectionName, recordId), recordData);
            }
            return addDoc(collection(db, collectionName), {
              ...recordData,
              createdAt: serverTimestamp(),
              createdBy: user.uid
            });
          },
          Boolean(mediaFile),
          async () => {
            publishingStage = 'uploading media';
            const message = 'Uploading media to Cloudinary…';
            if (feedback) feedback.textContent = message;
            showStatus(message);
            const media = await uploadMedia(mediaFile);
            mediaUploaded = true;
            return media;
          }
        );
        if (recordId && mediaUploaded && previousMedia?.mediaPath) {
          try {
            await deleteObject(ref(storage, previousMedia.mediaPath));
          } catch (error) {
            console.error('Content was updated, but its previous Firebase Storage media could not be deleted:', error);
            mediaCleanupError = error;
          }
        }
        resetContentForm(form, formConfig.title, formConfig.button);
        if (feedback) {
          feedback.dataset.state = 'success';
          feedback.hidden = false;
          feedback.textContent = recordId ? `${formConfig.success} updated.` : collectionName === 'products' ? 'Product published and live in the store.' : 'Published and live on the site.';
        }
        if (mediaCleanupError) {
          showStatus(`${formConfig.success} updated, but its previous media could not be cleaned up: ${mediaCleanupError.message}`, true);
        } else if (!previousMedia?.mediaPath && previousMedia?.mediaPublicId && mediaUploaded) {
          showStatus(`${formConfig.success} updated. Remove the replaced media from Cloudinary if you no longer need it.`);
        } else {
          showStatus(recordId ? `${formConfig.success} updated.` : 'Published. It’s live on the site.');
        }
      } catch (error) {
        const orphanNote = mediaUploaded
          ? ' The media reached Cloudinary, but the post could not be saved; remove the unused file from Cloudinary if needed.'
          : '';
        if (feedback) {
          feedback.dataset.state = 'error';
          feedback.textContent = `Could not publish: ${error.message}.${orphanNote}`;
        }
        showStatus(`Could not publish: ${error.message}.${orphanNote}`, true);
      } finally {
        window.clearTimeout(slowPublishTimer);
        submit.disabled = false;
        cancelButton.disabled = false;
        submit.classList.remove('is-publishing');
        submit.innerHTML = form.elements.namedItem('recordId').value ? submitContent : defaultSubmitContent;
      }
    });
  });
}

function initCalendar() {
  const calendar = $('#calendarDays');
  if (!calendar) return;
  window.calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  $('#prevMonth').addEventListener('click', () => {
    window.calendarMonth = new Date(window.calendarMonth.getFullYear(), window.calendarMonth.getMonth() - 1, 1);
    updateCalendar();
  });
  $('#nextMonth').addEventListener('click', () => {
    window.calendarMonth = new Date(window.calendarMonth.getFullYear(), window.calendarMonth.getMonth() + 1, 1);
    updateCalendar();
  });
  updateCalendar();
}

document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-year]').forEach((node) => { node.textContent = String(new Date().getFullYear()); });
  initCalendar();
  if (!hasFirebaseConfig) {
    showStatus('Firebase is not configured yet. Add your project settings to firebase-config.js.', true);
    ['#homeEvents', '#allEvents', '#homeNews', '#allNews', '#products'].forEach((selector) => {
      const container = $(selector);
      if (container) container.replaceChildren(element('p', 'empty-state', 'Connect Firebase to share the crew’s latest plans and stories.'));
    });
    return;
  }
  try {
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    storage = getStorage(app);
    setupAdmin();
    if (!$('#loginPanel')) subscribeToContent();
  } catch (error) {
    console.error('Firebase initialization failed:', error);
    showStatus(`Could not connect to Firebase: ${error.message}`, true);
  }
});
