(() => {
  function searchKey(value) {
    return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('it');
  }

  const collator = new Intl.Collator('it', { sensitivity: 'base' });

  for (const section of document.querySelectorAll('[data-admin-list]')) {
    const tools = section.querySelector('.org-tools');
    if (!tools) continue;
    const query = section.querySelector('[data-admin-query]');
    const filters = [...section.querySelectorAll('[data-admin-kind]')];
    const sort = section.querySelector('[data-admin-sort]');
    const count = section.querySelector('[data-admin-count]');
    const entries = [...section.querySelectorAll('[data-admin-item]')].map(item => ({
      item, text: searchKey(item.dataset.search), kinds: item.dataset.kinds.split(' ')
    }));

    function applyFilters() {
      const words = searchKey(query.value).trim().split(/\s+/);
      const selected = filters.map(filter => filter.value).filter(Boolean);
      let shown = 0;
      for (const { item, text, kinds } of entries) {
        item.hidden = !selected.every(kind => kinds.includes(kind)) || !words.every(word => text.includes(word));
        if (!item.hidden) shown++;
      }
      count.textContent = shown ? shown + ' di ' + entries.length + ' risultati' : 'Nessun risultato per la ricerca.';
    }

    if (sort) {
      const list = section.querySelector('.org-guests');
      function applySort() {
        const sortKey = sort.value;
        entries.sort(({ item: a }, { item: b }) => {
          const first = a.dataset;
          const second = b.dataset;
          if (sortKey === 'family' && Boolean(first.family) !== Boolean(second.family)) return first.family ? -1 : 1;
          const order = sortKey === 'updated' ? collator.compare(second.updated, first.updated)
            : collator.compare(first[sortKey], second[sortKey]);
          return order || collator.compare(first.search, second.search);
        });
        list.append(...entries.map(({ item }) => item));
      }
      sort.addEventListener('change', applySort);
      applySort();
    }

    query.addEventListener('input', applyFilters);
    for (const filter of filters) filter.addEventListener('change', applyFilters);
    tools.hidden = count.hidden = false;
    applyFilters();
  }

  const editor = document.querySelector('[data-admin-editor]');
  if (editor) {
    const attendance = editor.querySelector('[data-edit-attendance]');
    const companions = editor.querySelector('[data-edit-companions]');
    const children = editor.querySelector('[data-edit-children]');
    function syncPeople() {
      const attending = attendance.value === 'yes';
      for (const group of editor.querySelectorAll('[data-edit-group]')) group.hidden = !attending;
      for (const field of editor.querySelectorAll('[data-edit-companion]')) field.hidden = Number(companions.value) === 0;
      for (const section of editor.querySelectorAll('[data-edit-person]')) {
        const person = section.dataset.editPerson;
        section.hidden = (person === 'companion' && Number(companions.value) === 0) ||
          (person.startsWith('child-') && Number(person.at(-1)) > Number(children.value));
      }
    }
    editor.addEventListener('change', syncPeople);
    syncPeople();
  }
})();
