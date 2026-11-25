/// <reference types="vite/client" />
/** node:sqlite's DatabaseSync, as much as store.ts uses, on sql.js (SQLite compiled to WebAssembly). */
import initSqlJs from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'

const SQL = await initSqlJs({ locateFile: () => wasmUrl })

export type SQLInputValue = null | number | bigint | string | Uint8Array
type Row = Record<string, SQLInputValue>

export class DatabaseSync {
  #db = new SQL.Database()
  isOpen = true
  /** sql.js has no autocommit flag: store.ts only opens and ends transactions through exec. */
  isTransaction = false

  exec(sql: string) {
    this.#db.exec(sql)
    const verb = sql.trim().slice(0, 8).toUpperCase()
    if (verb.startsWith('BEGIN')) this.isTransaction = true
    else if (/^(COMMIT|ROLLBACK|END)/.test(verb)) this.isTransaction = false
  }

  prepare(sql: string) {
    const rows = (params: SQLInputValue[]): Row[] => {
      const st = this.#db.prepare(sql)
      try {
        st.bind(params.map(v => (typeof v === 'bigint' ? Number(v) : v)))
        const out: Row[] = []
        while (st.step()) out.push(st.getAsObject() as Row)
        return out
      } finally {
        st.free()
      }
    }
    return {
      run: (...p: SQLInputValue[]) => { rows(p); return { changes: this.#db.getRowsModified(), lastInsertRowid: 0 } },
      get: (...p: SQLInputValue[]) => rows(p)[0],
      all: (...p: SQLInputValue[]) => rows(p),
    }
  }

  close() {
    this.#db.close()
    this.isOpen = false
  }
}
