import { MemoryRecordStore } from './memory-record-store'
import { describeRecordStoreContract } from './record-store-contract'

describeRecordStoreContract('MemoryRecordStore', () => new MemoryRecordStore())
