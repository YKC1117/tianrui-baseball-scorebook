import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sealArchive,decodeArchive} from '../src/backup-integrity.mjs';
test('cloud archive checksum rejects corruption and legacy backups remain readable',async()=>{
 const payload={format:'TR-SECURE-BACKUP-15',workspace:{db:{games:[]}},serverAudit:[{name:'測試紀錄員'}]};
 const sealed=await sealArchive(payload);assert.deepEqual(JSON.parse(await decodeArchive(sealed)),payload);
 const broken=JSON.parse(sealed);broken.payload.serverAudit[0].name='竄改';await assert.rejects(decodeArchive(JSON.stringify(broken)),/完整性/);
 const legacy='{"games":[]}';assert.equal(await decodeArchive(legacy),legacy);
});
