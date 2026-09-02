// Uebersicht aller Aufnahmen: ansehen, einzeln loeschen, alles exportieren.
const grid = document.getElementById('grid');
const count = document.getElementById('count');
const empty = document.getElementById('empty');

function formatDateTime(iso) {
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function card(photo) {
  const item = document.createElement('li');
  item.className = 'card';

  const link = document.createElement('a');
  link.href = `/p/${photo.id}`;
  link.className = 'card__link';
  const image = document.createElement('img');
  image.src = photo.url;
  image.alt = `Aufnahme vom ${formatDateTime(photo.createdAt)}`;
  image.loading = 'lazy';
  link.append(image);

  const footer = document.createElement('div');
  footer.className = 'card__footer';
  const time = document.createElement('span');
  time.textContent = formatDateTime(photo.createdAt);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'card__delete';
  remove.textContent = 'Löschen';
  remove.addEventListener('click', async () => {
    if (!confirm('Dieses Foto endgültig löschen?')) return;
    const response = await fetch(`/api/photos/${photo.id}`, { method: 'DELETE' });
    if (response.ok) {
      item.remove();
      await load();
    } else {
      alert('Löschen fehlgeschlagen.');
    }
  });
  footer.append(time, remove);

  item.append(link, footer);
  return item;
}

async function load() {
  try {
    const photos = await fetch('/api/photos').then((response) => {
      if (!response.ok) throw new Error(`Laden fehlgeschlagen (${response.status})`);
      return response.json();
    });
    grid.replaceChildren(...photos.map(card));
    count.textContent = photos.length === 1 ? '1 Aufnahme' : `${photos.length} Aufnahmen`;
    empty.hidden = photos.length > 0;
  } catch (err) {
    count.textContent = err.message;
    empty.hidden = true;
  }
}

load();
