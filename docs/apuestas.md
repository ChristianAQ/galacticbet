# Apuestas: análisis de la IA

La pestaña **Apuestas** (`#/apuestas`) muestra, para cada día de LaLiga o
Champions, las apuestas de bet365 (u otra casa española si bet365 no está al
día) en las que la IA ve valor: las que pagan más de lo que deberían según su
probabilidad. Para cada partido da también una recomendación, todas sus cuotas
con su probabilidad y una etiqueta de confianza. Es información: GalacticBet
no gestiona apuestas ni dinero.

## Cómo funciona

1. **Cuándo.** El análisis se hace 45 minutos antes del primer partido aún
   por jugar de cada día de LaLiga o Champions, y llega entre 35 y 45 minutos
   antes. Hay uno por competición y día en hora de España (`PD-2026-11-28`).
   GitHub ejecuta las tareas programadas con horas de retraso, o no las ejecuta,
   en días de mucha carga: el 26/11/2026 las de cada 10 minutos solo corrían unas
   3 veces al día. Por eso el workflow `AI betting analysis` no depende de su
   horario:
   - en modo automático calcula cuándo toca el próximo análisis, espera dentro
     del propio job hasta esa hora (hasta 5 h 15 min) y lo hace;
   - si falta más y el día de partidos está a menos de 18 horas, espera ese tiempo
     y se vuelve a lanzar él mismo (`gh workflow run`, con el permiso
     `actions: write` del propio workflow);
   - también arranca al terminar cualquier sincronización o despliegue
     (`workflow_run`) y con un horario ligero cada 3 horas.

   Si GitHub se salta la ventana, el análisis se hace antes del siguiente
   partido de ese día.

   Si un intento falla (límite de uso del plan de Claude, OddsPapi caído o sin
   cuotas), se repite a los 20 minutos, como mucho 3 veces por día
   (`providerBudgets/analysisAttempts`): nunca en bucle, que gastaría el cupo
   de OddsPapi. Las cuotas leídas se guardan una hora en
   `providerCache/oddspapiDay` (solo backend) y los reintentos del mismo día
   las reutilizan, sin peticiones nuevas; el informe dice a qué hora se
   leyeron. Si el plan de Claude se agota o caduca, cada día gasta así una sola
   lectura de cuotas, no tres.
2. **Cuotas.** OddsPapi (plan gratuito, 250 peticiones al mes). Cada análisis
   hace una petición con los partidos del día (para emparejar los nombres) y
   otra por partido. Cada una de estas trae a la vez bet365, varias casas con
   licencia en España y Pinnacle (`pinnacle+30`), la casa de referencia, de la
   que se quita el margen para obtener la probabilidad justa. Un día de LaLiga
   gasta entre 2 y 5 peticiones; uno de Champions, unas 10.

   **bet365 primero.** OddsPapi no siempre tiene bet365 al día (en la prueba
   del 26/11/2026 solo lo estaba en 1 de 22 partidos de LaLiga, con cuotas de
   hacía una semana). Las cuotas de una casa que OddsPapi no está leyendo
   (`bookmakerIsActive: false`) o que tiene suspendida no se usan nunca. En ese
   caso se usa la primera casa española al día, en este orden: Winamax,
   888sport, bwin, Codere, LeoVegas, Golden Park, William Hill, Betway y
   Betsson. La app muestra la casa junto a cada cuota.

   Mercados: 1X2, doble oportunidad, empate no válido, ambos marcan y más/menos
   de 1,5, 2,5 y 3,5 goles, y de jugador: **goleador** (marca en cualquier
   momento), **tarjeta a jugador** y **tiros** y **tiros a puerta** («al menos
   N», prórroga incluida), de la misma casa que el resto del partido y en la
   misma petición. De goleador y tarjeta, los 20 jugadores con la cuota más
   corta; de tiros, los 8 más cortos de cada escalón que se ofrece: al menos 2
   y 3 tiros, y al menos 1 y 2 a puerta (en la prueba del 27/11/2026, Winamax
   daba de 1+ a 6+ con unos 50 jugadores por escalón). Los nombres se guardan
   como «Sergio Canales» aunque la casa escriba «Canales, Sergio». La lista oficial de mercados, con los de jugador, se guarda un mes
   (`providerCache/oddspapiMarkets`). El consumo se cuenta en
   `providerBudgets/oddspapi`, con un tope interno de 220 peticiones al mes.
3. **Datos.** Se añaden la clasificación, la forma, los partidos en casa y
   fuera, los goles a favor y en contra, el porcentaje de partidos con ambos
   marcando y con más de 2,5 goles, los enfrentamientos previos y los
   goleadores. Y, del acta de ESPN (`matchInsights`) de los 4 últimos
   partidos de cada equipo en cualquier competición, lo que hizo cada jugador:
   jugados y de titular, tiros, a puerta, goles, asistencias, faltas y
   tarjetas (los 8 que más tiran; `jugadoresUltimosPartidos`). La IA lo usa
   en las apuestas de jugador. Son como mucho 80 lecturas de Firestore por
   día analizado, y solo sirven las fichas sincronizadas desde que se guardan
   los números por jugador.
4. **IA.** Claude Code se ejecuta sin interfaz con el plan de Claude del
   propietario (token de `claude setup-token`). Trabaja en una carpeta vacía,
   solo puede buscar en la web (bajas y alineaciones, al menos una búsqueda por
   partido) y no ve ningún otro secreto del job. Devuelve un JSON validado con
   dos cosas:
   - **Apuestas con valor:** hasta 6 apuestas (como mucho 2 por partido) que pagan
     al menos un 3 % más de lo justo según su estimación. Con casas normales
     son pocas: suelen pagar entre un 5 y un 9 % menos que el precio justo de
     Pinnacle.
   - **La recomendación de cada partido**, siempre. Es la apuesta con más valor
     esperado entre las que tienen al menos un 40 % de probabilidad, aunque su
     valor sea negativo. La app lo dice tal cual: «Paga bien · +4 %»,
     «Paga lo justo» o «Paga poco · −3 %».

   Se le pide vocabulario de análisis (valor, probabilidad, cuota, margen) y
   nada coloquial.
5. **Validación.** Solo se guardan apuestas sobre mercados que existen, con
   la cuota real de la casa (nunca la de la IA). Una apuesta con valor tiene que mostrar
   al menos «+3 %» de valor según la IA (redondeado: desde un 2,5 %) y la IA
   no puede darle más de 10 puntos por encima de la probabilidad justa de
   Pinnacle: más que eso es exceso de confianza, no valor. La recomendación de
   un partido necesita al menos un 40 % de probabilidad.

   **Apuestas de jugador.** Pinnacle no las cotiza: no hay valor «según el
   mercado». La referencia es la probabilidad de la propia cuota (1 / cuota,
   con el margen de la casa) y la IA no puede pasarla en más de 10 puntos.
   Como mucho 2 entre las apuestas con valor. El job las resuelve en cada pasada con el
   acta del partido de ESPN (`matchInsights`, el campo `insight`): marca, ve
   tarjeta o llega a los tiros, acertada; jugó y no, fallada; no jugó (ni
   titular ni entró), nula, como en las casas. Los tiros salen de los números
   por jugador del acta. Para dar por fallada una apuesta, el acta tiene que
   haberse leído con el partido ya terminado (`status: FINISHED` en el
   documento); antes solo puede darse por acertada. Para fallar un goleador
   hacen falta además todos los goles del marcador en el acta. Si el acta no
   se completa en una semana, la apuesta es nula. La hora de las
   cuotas es la de su lectura, no la de la respuesta de la IA. El resultado se
   publica en `analysis/football`, un documento público de solo lectura con
   los 24 últimos análisis y, en `archive`, los totales de los anteriores.

## IA y datos, siempre separados

Cada bloque lleva una etiqueta: **IA** si lo ha hecho la IA (la probabilidad
estimada, el valor que sale de ella, las recomendaciones y los textos) o
**Datos** si son datos reales (cuotas, el mercado de Pinnacle, la forma y los
resultados oficiales). Bajo el titular, la **ficha técnica** («Informe elaborado
por IA») dice el modelo de Claude que lo hizo, las búsquedas web que hizo y
cuánto tardó (lo que devuelve Claude Code en `modelUsage` y `usage`, guardado en
`ai` del análisis), la hora del análisis y de las cuotas, la casa, el mercado de
referencia, la fuente de las estadísticas y cuántas cuotas se evaluaron.

## En la app

Lo importante se ve de un vistazo, con gráficas:

- **De un vistazo:** cuánto paga la recomendación de cada partido, alrededor
  de cero, con la marca de «paga bien» (+3 %). Tocar un partido lleva a su
  ficha dentro del análisis.
- **Confianza:** cada apuesta lleva «Confianza muy alta / alta / media / baja»
  con su porcentaje y de una a cuatro barras. Es la probabilidad de ganarla,
  con una escala fija: muy alta desde el 70 %, alta desde el 55 %, media desde
  el 40 % y baja por debajo. Se usa la estimación de la IA, nunca por encima
  de la del mercado (Pinnacle sin margen) cuando la hay. La solidez de los
  argumentos que da la IA es otra cosa y va en «Por qué y de dónde sale».
- **Cuotas del partido:** en cada partido, todas las opciones principales
  (1X2, doble oportunidad, empate no válido, ambos marcan y más/menos goles)
  con su cuota, su probabilidad sin margen, su confianza y su «Pago»: lo que
  paga la cuota frente a esa probabilidad (0 % sería lo justo; las casas
  suelen pagar algo menos, su margen). Ordenadas de más a menos probable, con
  la **mejor pagada** y la **recomendación** marcadas. Se guardan con el
  análisis (`matches[].options`).
- **¿Quién gana?:** las probabilidades de 1, X y 2 sin margen, de Pinnacle o,
  si no hay, de la casa.
- **Goles:** probabilidad de más de 2,5 goles y de que marquen los dos.
- **Forma:** los últimos cinco resultados de cada equipo.
- **¿Compensa?:** la probabilidad que da la IA frente a la que necesita la
  cuota para compensar (1 / cuota). Si la barra pasa la marca, paga de más.
  Un punto marca la del mercado (Pinnacle sin margen), cuando la hay. Debajo,
  en una frase: cuántas veces de cada 100 hay que acertar para no perder y
  cuánto volvería de media de cada 10 € apostados muchas veces, según la IA y
  según el mercado. Así se ve enseguida cuándo el mercado no está de acuerdo.
- **Cuánto paga:** una etiqueta con la cuota frente a la probabilidad de la
  IA. «Paga bien · +5 %» desde +3 % (de cada 10 €, volverían 10,50 € de
  media), «Paga lo justo» entre −2 % y +2 % y «Paga poco · −4 %» desde −3 %.

Para moverse: bajo el titular, accesos a «Con valor», «Combinada»,
«Partidos» e «Historial». Cada partido aparece plegado en una línea (su
recomendación, cuota y valor); al tocarlo se abre con sus gráficas, todas
sus cuotas y el «Por qué». Si su recomendación ya está entre las apuestas
con valor, no se repite: un acceso lleva hasta ella. Lo que significa cada
dato está una sola vez, en «Cómo leer el análisis» (el «?» de arriba).

El texto queda en segundo plano, plegado en «Por qué y de dónde sale»: la
previa, el motivo, el riesgo y el origen de cada dato (cuotas, casa y hora;
resultados oficiales; las webs que leyó la IA, solo el nombre del sitio y sin
enlace; la hora del análisis). Los colores de 1 · X · 2 (ámbar, gris y azul)
están validados para daltonismo en los dos temas y son los mismos en Ligas ›
Datos.

### Combinada

- **Combinada de valor.** Si un día hay apuestas con valor de al menos dos
  partidos, se forma sola con la mejor de cada partido (como mucho tres, la
  de más valor primero). Se fija al publicar el análisis
  (`analyses[].combo`, las claves de sus apuestas) y lleva su propio
  historial: gana si aciertan todas, pierde con una fallada; una nula cuenta a
  cuota 1, como en las casas.
- **Tu combinada.** «＋ Combinada» en cualquier apuesta del análisis la añade
  a la tuya; una de un partido que ya estaba ocupa su lugar (dos del mismo
  partido no se multiplican: están relacionadas y las casas las cotizan
  aparte). Un panel fijo enseña la cuota total y, al abrirlo, las apuestas, la
  probabilidad de acertarla según la IA y según el mercado, su valor y la
  gráfica «¿Compensa?». No se guarda: es una calculadora.
- Siempre con el mismo aviso: las cuotas se multiplican y el margen de la
  casa también; una combinada solo tiene valor si lo tiene cada apuesta, y se
  acierta pocas veces.

La app resuelve cada apuesta con el resultado oficial a 90 minutos y lleva
tres historiales a una unidad por apuesta, sin reescribir nada: el de las
apuestas con valor, el de la recomendación de cada partido y el de la
combinada de valor (una unidad por combinada, a su cuota total). Cuando un análisis sale del
documento (se guardan los 24 últimos), sus apuestas ya resueltas se suman a
los totales archivados de su competición: el historial no olvida ninguna e
indica desde cuándo cuenta.

## Configurar

En GitHub → Settings → Secrets and variables → Actions → **Repository
secrets**:

| Secreto | Qué es |
| - | - |
| `BET365_ODDS_KEY` | La clave de tu cuenta de [OddsPapi](https://oddspapi.io) (también vale `ODDSPAPI_KEY`). |
| `CLAUDE_CODE_OAUTH_TOKEN` | Token de tu plan de Claude (Pro o superior). Créalo una vez en tu ordenador con `claude setup-token` (Claude Code instalado). Dura un año. |

Opcional, en **Variables**: `CLAUDE_MODEL` para elegir el modelo (si no, el
de tu plan por defecto). Cada análisis consume uso de tu plan como una
conversación normal de Claude Code; no se paga nada aparte.

## Probar

Actions → **AI betting analysis** → Run workflow con el modo **prueba**: trae
las cuotas y los datos del próximo día de partidos y escribe en el registro
cuántos partidos se han emparejado, de qué casa son las cuotas y su 1X2. No
llama a la IA ni guarda nada. Gasta una petición más que el número de
partidos de ese día (dos la primera vez, para el catálogo de mercados).

También lista los **mercados de jugador** que da cada casa en cada partido
(goleador, remates a puerta…), cuántos jugadores tienen cuota, si la casa
está al día y qué campos trae cada cuota: las líneas «OddsPapi: … jugadores
en …». Salen de la misma respuesta que las cuotas del partido, sin gastar
peticiones aparte. Sirve para decidir qué mercados de jugador se pueden usar.

De los **tiros de jugador** da el detalle, una vez por prueba y de la casa
elegida: cada mercado con su línea (0,5, 1,5…), sus resultados (más/menos,
sí…), cuántos jugadores tienen cuota, tres de ejemplo y los campos en bruto:
las líneas «OddsPapi: tiros de jugador en …». También dice de cuántos partidos
recientes hay números de jugador para la IA («números de jugador de X/Y
partidos recientes»). La lista de mercados se vuelve a pedir una vez (una
petición) para guardar las líneas.

Con el modo **completo** genera y publica ya el análisis del próximo día de
partidos, aunque falte mucho. El análisis automático de 45 minutos antes lo
sustituye después con cuotas y alineaciones más frescas: un análisis hecho
más de 3 horas antes del primer partido no cuenta como hecho.

## Juego responsable

La pestaña muestra siempre el aviso +18 y un enlace a jugarbien.es. Las
cuotas cambian: hay que comprobarlas en bet365.
