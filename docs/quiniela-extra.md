# Quiniela: probabilidades, la IA, el favorito y tu perfil

Cuatro añadidos para seguir la jornada y la temporada. Todo es
información: no cambia los puntos oficiales del grupo.

## ¿Quién se lleva la jornada? (Quiniela › El grupo)

En cuanto sellas, bajo «Puntos de la jornada», cada jugador que ha sellado
tiene su **probabilidad de ganar la jornada** (sola o compartida: empatar en
cabeza cuenta como ganarla, como en el bote).

- Se simula la jornada 20.000 veces en el propio móvil, sin lecturas
  nuevas. Cada partido por jugar recibe goles de un modelo de Poisson
  ajustado a las probabilidades 1X2 sin margen de las casas.
- Las probabilidades salen de las congeladas al cierre
  (`machinePicks`, ver abajo) o, si no las hay, de las cuotas del día
  (`odds/football`). Un partido sin cuotas usa una probabilidad típica, y la
  nota lo dice.
- Un partido en juego conserva su marcador y solo juega los minutos que
  faltan (el minuto del directo). Las cifras se recalculan cada minuto y
  con cada gol.
- La simulación usa siempre la misma semilla para los mismos datos: las
  cifras no bailan al volver a la pantalla.

**Qué necesitas:** para ti, los partidos que más mueven tu probabilidad
(como mucho 3, y solo si la cambian 3 puntos o más), con tu probabilidad si
gana el local, si empatan o si gana el visitante. Debajo, **tu camino más
probable**: los resultados que más se repiten en las simulaciones en las que
ganas.

## La IA y el favorito juegan en tu grupo

Dos rivales fijos, fuera de la tabla oficial:

- **IA:** su propia quiniela. Lee los datos de la temporada (clasificación,
  forma, goles, enfrentamientos) y los titulares de ESPN, **sin cuotas**, y
  da un marcador por partido. Claude puede hacer hasta 4 búsquedas web
  (bajas); Gemini, sin búsqueda.
- **Favorito:** siempre lo que las casas dan más probable. En exacto, el
  marcador más probable con ese signo (según el mismo modelo de Poisson).

Las dos se cierran **antes que la tuya**: el workflow **AI front page** (a
las 7:45, 13:45 y 18:45) congela las quinielas de las jornadas que cierran
en las próximas 24 horas y completa lo que falte (una cuota aún no
publicada, la IA caída) en las pasadas siguientes, siempre antes del primer
partido. Nada se reescribe después del cierre. Se guardan en
`machinePicks/{temporada}` (`PD-2026`), un documento público de solo
lectura, con las probabilidades del mercado de ese momento.

Dónde se ven:

- En «Puntos de la jornada», debajo del grupo y atenuadas, con sus puntos.
- En Clasificación › Temporada, **Contra la máquina**: tus puntos, los de la
  IA y los del favorito en las jornadas terminadas que habéis jugado los
  tres, en cuántas jornadas les has ganado y cuántos del grupo van por
  delante de la IA.

## Tu perfil de pronosticador (Clasificación › Temporada)

Con tus boletos sellados y los resultados oficiales:

- tus signos acertados y tus puntos sobre los posibles (y los exactos);
- qué porcentaje aciertas de tus 1, tus X y tus 2;
- cuántas veces fuiste contra el favorito y cuántas acertaste;
- si le ganas al mercado: tus signos frente a los del favorito en los mismos
  partidos (con al menos 5);
- tu equipo (con el que más sumas por partido) y tu bestia negra (el que más
  puntos te ha costado), con al menos 3 partidos.

Cada boleto se lee una vez (una lectura por jornada) y se guarda en el
móvil: los sellados no cambian. Se borra al cerrar sesión, como el resto de
datos privados.
