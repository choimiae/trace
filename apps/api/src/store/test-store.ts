import { SqliteStore } from "./sqlite-store.js";

// 테스트용 저장소. 저장소 구현은 SQLite 하나뿐이고, 테스트는 파일 없이 메모리 DB 를 쓴다.
export function createTestStore(): SqliteStore {
  return new SqliteStore(":memory:");
}
