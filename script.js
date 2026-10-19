import { firebaseConfig } from './firebase-config.js';
import { escapeDate, validatePublishingDate } from './admin-validation.mjs';
import { deletePublishedContent } from './admin-delete.mjs';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js';
import {
  createUserWithEmailAndPassword, getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc, updateDoc
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import {
  deleteObject, getDownloadURL, getStorage, ref, uploadBytes
} from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';

const MAX_MEDIA_BYTES = 50 * 1024 * 1024;
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
    row.append(button);
    list.append(row);
  });
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
          uploaded = await uploadMedia(imageFile, user.uid);
          Object.assign(payload, uploaded);
        }
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
          uploaded = await uploadMedia(imageFile, user.uid);
          Object.assign(payload, uploaded);
        }
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
      showStatus(`Could not save crew profile: ${error.message}`, true);
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

async function uploadMedia(file, userId) {
  if (!file) return {};
  if (file.size > MAX_MEDIA_BYTES) throw new Error('Please choose a photo or video smaller than 50 MB.');
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) throw new Error('Choose an image or video file.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const mediaPath = `uploads/${userId}/${Date.now()}-${safeName}`;
  const mediaRef = ref(storage, mediaPath);
  await uploadBytes(mediaRef, file, { contentType: file.type });
  return { mediaUrl: await getDownloadURL(mediaRef), mediaPath, mediaType: file.type };
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
    { id: 'eventForm', collectionName: 'events', fields: ['title', 'date', 'time', 'location', 'description'] },
    { id: 'newsForm', collectionName: 'news', fields: ['title', 'date', 'body'] },
    { id: 'productForm', collectionName: 'products', fields: ['title', 'price', 'description'] }
  ].forEach(({ id, collectionName, fields }) => {
    const form = $(`#${id}`);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const user = auth.currentUser;
      if (!user) {
        showStatus('Sign in again before publishing.', true);
        return;
      }
      const formData = new FormData(form);
      const submit = $('button[type="submit"]', form);
      submit.disabled = true;
      showStatus('Publishing…');
      let uploaded;
      try {
        const date = String(formData.get('date') || '');
        validatePublishingDate(collectionName, date);
        const payload = Object.fromEntries(fields.map((field) => [field, String(formData.get(field) || '').trim()]));
        if (collectionName === 'products') payload.price = Number(formData.get('price'));
        if (collectionName === 'products' && (!Number.isFinite(payload.price) || payload.price < 0)) throw new Error('Enter a valid price.');
        const file = formData.get('media');
        uploaded = await uploadMedia(file instanceof File && file.size ? file : null, user.uid);
        await addDoc(collection(db, collectionName), {
          ...payload,
          ...uploaded,
          createdAt: serverTimestamp(),
          createdBy: user.uid
        });
        form.reset();
        showStatus('Published. It’s live on the site.');
      } catch (error) {
        if (uploaded && uploaded.mediaPath) {
          try {
            await deleteObject(ref(storage, uploaded.mediaPath));
          } catch (cleanupError) {
            console.error('Could not clean up an unlinked upload:', cleanupError);
          }
        }
        showStatus(`Could not publish: ${error.message}`, true);
      } finally {
        submit.disabled = false;
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
