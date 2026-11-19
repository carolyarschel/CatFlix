/**
 * Importa o histórico de filmes do Crônicas de Gatur antigo (cineon-expansao
 * §11). A lógica mora em `src/modules/importacao/`; isto só a chama.
 *
 *   npm run importar:cg -- --dump ../dumpCG.sql              # simulação
 *   npm run importar:cg -- --dump ../dumpCG.sql --aplicar    # grava
 */
import { executarImportacaoCg } from '../src/modules/importacao/importacao.cg.cli';

void executarImportacaoCg(process.argv.slice(2));
