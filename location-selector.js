(function () {
  let locationsPromise;

  function loadLocations() {
    if (!locationsPromise) {
      const locationDataUrl = window.jupteeAssetUrl
        ? window.jupteeAssetUrl('assets/data/bangladesh-locations.json')
        : 'assets/data/bangladesh-locations.json';
      locationsPromise = fetch(locationDataUrl, { headers: { Accept: 'application/json' } })
        .then(async response => {
          if (!response.ok) throw new Error(`Location data request failed (${response.status}).`);
          const data = await response.json();
          const divisions = Array.isArray(data.divisions) ? data.divisions : [];
          const districts = divisions.flatMap(division => division.districts || []);
          const units = districts.flatMap(district => district.upazilas || []);
          if (divisions.length !== 8 || districts.length !== 64 || units.length < 500) {
            throw new Error('The Bangladesh location dataset is incomplete.');
          }
          return divisions;
        })
        .catch(error => {
          locationsPromise = null;
          throw error;
        });
    }
    return locationsPromise;
  }

  function optionLabel(item) {
    return item.bnName ? `${item.name} — ${item.bnName}` : item.name;
  }

  function fillSelect(select, items, placeholder, query = '') {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const selected = items.find(item => String(item.id) === select.value);
    const matches = items.filter(item => `${item.name} ${item.bnName || ''}`.toLocaleLowerCase().includes(normalizedQuery));
    if (selected && !matches.includes(selected)) matches.unshift(selected);
    const selectedValue = select.value;
    select.replaceChildren(new Option(normalizedQuery && !matches.length ? 'No matching locations' : placeholder, ''));
    for (const item of matches) select.add(new Option(optionLabel(item), String(item.id)));
    if (selectedValue && matches.some(item => String(item.id) === selectedValue)) select.value = selectedValue;
    select.disabled = items.length === 0;
  }

  function init(root) {
    if (!root || root.dataset.locationReady === 'true') return;
    root.dataset.locationReady = 'true';
    const division = root.querySelector('[name="division"]');
    const district = root.querySelector('[name="district"]');
    const upazila = root.querySelector('[name="upazila"]');
    const divisionSearch = root.querySelector('[name="divisionSearch"]');
    const districtSearch = root.querySelector('[name="districtSearch"]');
    const upazilaSearch = root.querySelector('[name="upazilaSearch"]');
    const feedback = root.querySelector('[data-location-feedback]');
    const retry = root.querySelector('[data-location-retry]');
    if (!division || !district || !upazila || !divisionSearch || !districtSearch || !upazilaSearch) {
      root.dataset.locationReady = '';
      throw new Error('The location selector fields are incomplete.');
    }

    const clearChildren = () => {
      fillSelect(district, [], 'Choose a division first');
      fillSelect(upazila, [], 'Choose a district first');
      districtSearch.disabled = true;
      upazilaSearch.disabled = true;
      districtSearch.value = '';
      upazilaSearch.value = '';
    };

    divisionSearch.addEventListener('input', () => fillSelect(division, root.locationData, 'Choose division', divisionSearch.value));
    districtSearch.addEventListener('input', () => {
      const selectedDivision = root.locationData.find(item => String(item.id) === division.value);
      fillSelect(district, selectedDivision?.districts || [], 'Choose district', districtSearch.value);
    });
    upazilaSearch.addEventListener('input', () => {
      const selectedDivision = root.locationData.find(item => String(item.id) === division.value);
      const selectedDistrict = selectedDivision?.districts.find(item => String(item.id) === district.value);
      fillSelect(upazila, selectedDistrict?.upazilas || [], 'Choose upazila / thana', upazilaSearch.value);
    });

    division.addEventListener('change', () => {
      divisionSearch.value = '';
      fillSelect(division, root.locationData, 'Choose division');
      const selected = root.locationData.find(item => String(item.id) === division.value);
      clearChildren();
      districtSearch.disabled = !selected;
      fillSelect(district, selected?.districts || [], 'Choose district');
      root.dispatchEvent(new CustomEvent('locationchange', { bubbles: true, detail: { level: 'division', item: selected || null } }));
    });
    district.addEventListener('change', () => {
      districtSearch.value = '';
      const selectedDivision = root.locationData.find(item => String(item.id) === division.value);
      fillSelect(district, selectedDivision?.districts || [], 'Choose district');
      const selected = selectedDivision?.districts.find(item => String(item.id) === district.value);
      fillSelect(upazila, selected?.upazilas || [], 'Choose upazila / thana');
      upazilaSearch.value = '';
      upazilaSearch.disabled = !selected;
      root.dispatchEvent(new CustomEvent('locationchange', { bubbles: true, detail: { level: 'district', item: selected || null } }));
    });
    upazila.addEventListener('change', () => {
      upazilaSearch.value = '';
      const selectedDivision = root.locationData.find(item => String(item.id) === division.value);
      const selectedDistrict = selectedDivision?.districts.find(item => String(item.id) === district.value);
      fillSelect(upazila, selectedDistrict?.upazilas || [], 'Choose upazila / thana');
      const selected = selectedDistrict?.upazilas.find(item => String(item.id) === upazila.value);
      root.dispatchEvent(new CustomEvent('locationchange', { bubbles: true, detail: { level: 'upazila', item: selected || null } }));
    });
    retry?.addEventListener('click', () => {
      retry.hidden = true;
      if (feedback) feedback.textContent = 'Loading Bangladesh locations…';
      initialize(root);
    });

    function initialize(selectorRoot) {
      loadLocations().then(locations => {
        selectorRoot.locationData = locations;
        fillSelect(division, locations, 'Choose division');
        divisionSearch.disabled = false;
        clearChildren();
        const savedDivision = selectorRoot.dataset.division || '';
        const savedDistrict = selectorRoot.dataset.district || '';
        const savedUpazila = selectorRoot.dataset.upazila || '';
        if (savedDivision) {
          division.value = savedDivision;
          division.dispatchEvent(new Event('change', { bubbles: true }));
          if (savedDistrict) {
            district.value = savedDistrict;
            district.dispatchEvent(new Event('change', { bubbles: true }));
            if (savedUpazila) {
              upazila.value = savedUpazila;
              upazila.dispatchEvent(new Event('change', { bubbles: true }));
            }
          }
        }
        if (feedback) feedback.textContent = '';
        if (retry) retry.hidden = true;
        selectorRoot.dispatchEvent(new CustomEvent('locationsloaded', { bubbles: true }));
      }).catch(error => {
        console.error('Could not load Bangladesh checkout locations:', error);
        if (feedback) feedback.textContent = 'Location data could not be loaded. Please retry before placing your order.';
        if (retry) retry.hidden = false;
      });
    }

    initialize(root);
  }

  window.initializeLocationSelectors = init;
})();
