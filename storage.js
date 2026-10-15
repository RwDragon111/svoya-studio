let database;
export function connect() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('svoya-studio', 1);
    request.onupgradeneeded = () => {
      for (const name of ['projects', 'games']) request.result.createObjectStore(name, {keyPath: 'id'});
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {db.close(); database = null;};
      resolve(db);
    };
    request.onerror = () => {database = null; reject(request.error);};
    request.onblocked = () => reject(new Error('Закройте старые вкладки конструктора и обновите страницу.'));
  });
  return database;
}
async function run(store, mode, action) {
  const db = await connect();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error || request.error);
    tx.onabort = () => reject(tx.error || new Error('Сохранение прервано.'));
  });
}
export const allProjects = () => run('projects', 'readonly', s => s.getAll());
export const saveProject = p => run('projects', 'readwrite', s => s.put(p));
export async function deleteProject(id) {
  await run('projects', 'readwrite', s => s.delete(id));
  await run('games', 'readwrite', s => s.delete(id));
  await run('games', 'readwrite', s => s.delete(`snapshot:${id}`));
}
export const saveGame = game => run('games', 'readwrite', s => s.put(game));
export const saveGameSnapshot = project => run('games', 'readwrite', s => s.put({id:`snapshot:${project.id}`,project}));
export async function loadGame(id) {
  const [record,snapshot] = await Promise.all([run('games','readonly',s=>s.get(id)),run('games','readonly',s=>s.get(`snapshot:${id}`))]);
  return record && snapshot ? {...record,project:snapshot.project} : null;
}
