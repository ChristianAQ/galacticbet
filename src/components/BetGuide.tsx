import { CONFIDENCE_LEVELS, MIN_VALUE } from "../lib/bettingAnalysis";
import Modal from "./Modal";

const pct = (p: number) => `${Math.round(p * 100)} %`;
const line = pct(MIN_VALUE);
const levels = CONFIDENCE_LEVELS.filter((l) => l.min > 0)
  .map((l) => `${l.label} desde ${pct(l.min)}`)
  .join(", ");

/**
 * «Cómo leer el análisis»: every explanation once. The cards keep only their
 * figures; whoever wants the meaning comes here.
 */
export default function BetGuide({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="Cómo leer el análisis" className="bet-guide" detents={["large"]} onClose={onClose}>
      <dl className="bet-guide-list">
        <div>
          <dt>Paga bien · paga poco</dt>
          <dd>
            La cuota frente a la probabilidad que da la IA. +5 % quiere decir que, apostada muchas veces, de cada 10 €
            volverían 10,50 €. Paga bien desde +{line} y poco desde −{line}; en medio, lo justo.
          </dd>
        </div>
        <div>
          <dt>¿Compensa?</dt>
          <dd>
            La barra es la probabilidad de la IA; la raya, la que hace falta para no perder a esa cuota (1 ÷ cuota: a 2,00
            hay que acertar 50 de cada 100); el punto, la del mercado. Si la barra pasa la raya, paga de más.
          </dd>
        </div>
        <div>
          <dt>Confianza</dt>
          <dd>
            La probabilidad de ganar la apuesta: {levels}; baja por debajo. No es el valor: una apuesta muy probable puede
            pagar poco. La «solidez» del «Por qué» es otra cosa: lo firmes que ve la IA sus propios motivos.
          </dd>
        </div>
        <div>
          <dt>Mercado</dt>
          <dd>
            Pinnacle sin su margen, la casa de referencia (o la propia casa si Pinnacle no lo cotiza). En la tabla de
            cuotas, «Mercado» es lo que paga cada cuota frente a esa probabilidad: suele salir negativo, es el margen de la
            casa.
          </dd>
        </div>
        <div>
          <dt>Combinadas</dt>
          <dd>
            Las cuotas se multiplican y el margen de la casa también: una combinada solo tiene valor si lo tiene cada
            apuesta, y se acierta pocas veces. Con «+ Combinada» montas la tuya (una apuesta por partido).
          </dd>
        </div>
        <div>
          <dt>Apuestas de jugador</dt>
          <dd>
            Pinnacle no las cotiza: solo hay la estimación de la IA, no la del mercado. Se resuelven con el acta del
            partido de ESPN; si el jugador no llega a jugar, son nulas.
          </dd>
        </div>
        <div>
          <dt>De dónde sale</dt>
          <dd>
            Cuotas de bet365 (o de otra casa española si bet365 no está al día) y de Pinnacle, vía OddsPapi; resultados
            oficiales de Football-Data; noticias que lee la IA. El análisis lo hace una IA (Claude o, si no está
            disponible, Gemini) unos 40 minutos antes del primer partido de cada día; la ficha técnica dice cuál fue y si
            buscó en internet.
          </dd>
        </div>
        <div>
          <dt>Historial</dt>
          <dd>Una unidad por apuesta a la cuota del análisis, resuelta con el resultado oficial a 90 minutos.</dd>
        </div>
      </dl>
    </Modal>
  );
}
