# Inicio: «La IA te cuenta»

En Inicio, bajo «Próximo saque», la IA hace una pequeña portada: lo que se
viene y los partidos que merece la pena seguir. Los titulares ya están en
«Actualidad», así que no los repite: los usa como contexto. Es información:
no habla de apuestas ni de cuotas.

## Qué se ve

- **Titular y resumen** de lo que se viene (2 o 3 frases).
- **Partidos clave:** hasta 4 de los próximos días. Cada uno con lo que está
  en juego («Duelo por el liderato»), una previa con datos (puestos, puntos,
  forma, goles, enfrentamientos) y «Qué vigilar». Al tocarlo se abre la
  ficha del partido. Siguen el calendario de la app: si el partido cambia de
  hora se ve la nueva, en juego muestra el marcador, y desaparece 2 horas
  después del saque o si se aplaza.
- Al pie, la ficha: «Elegido y escrito por IA», el modelo, si buscó en la
  web y la hora.

Si la portada tiene más de 36 horas, no se muestra: hablaría de días ya
pasados. Tampoco cuando ya se han jugado todos sus partidos clave. Sin
portada publicada (o en el modo demo), la sección no aparece.

## Cómo funciona

El workflow **AI front page** (`.github/workflows/briefing.yml`,
`npm run briefing`) se lanza a las 7:45, 13:45 y 18:45 (hora de España). Si
la portada publicada tiene menos de 3 horas no hace nada, así que un horario
repetido no gasta la IA, y uno retrasado un par de horas no hace saltarse el
siguiente.

1. **Partidos:** los que aún no han empezado de los próximos 4 días (si hay
   menos de 3, los de las próximas 2 semanas: un parón), como mucho 30. De
   cada uno, lo mismo que lee el análisis de apuestas sin las cuotas:
   clasificación, forma, partidos en casa y fuera, goles, porcentajes de
   «ambos marcan» y «más de 2,5», goleadores y enfrentamientos previos.
   También los resultados de los últimos 2 días.
2. **Noticias, como contexto:** los titulares de ESPN que guarda la
   sincronización (`news/football`, todas las competiciones) de los últimos
   4 días, sin repetir, como mucho 18. La IA los usa para explicar los
   partidos (bajas, rachas, cambios de entrenador), no para listarlos.
3. **IA:** la misma que en Apuestas y en el mismo orden: Claude con el plan
   (`CLAUDE_CODE_OAUTH_TOKEN`; puede hacer como mucho 4 búsquedas web para
   confirmar bajas) y, si falla, Gemini gratis (`GEMINI_API_KEY`, sin
   búsqueda web). `ANALYSIS_AI=gemini` pone Gemini primero.
4. **Validación:** solo se aceptan partidos de la lista, cada uno una vez.
   El equipo, el escudo y la hora se copian de nuestros datos, nunca de la
   IA. Los textos se recortan a los límites de la app. Si no queda ningún
   partido, la respuesta se descarta.
5. Se publica en `briefing/football`, un documento público de solo lectura
   (solo lo escribe el backend). Si la IA falla, se conserva la portada
   anterior y el job termina en error para que se vea en Actions.

La app lo lee como mucho cada 10 minutos (y al tirar para actualizar).

El mismo workflow congela también las quinielas de la IA y del favorito de
las jornadas que cierran en las próximas 24 horas: ver
[Quiniela: probabilidades, la IA, el favorito y tu perfil](quiniela-extra.md).

## Probar

Actions → **AI front page** → Run workflow:

- **prueba:** genera la portada con la IA y la escribe en el registro, sin
  guardar nada.
- **completo:** genera y publica una nueva ya, aunque la actual sea reciente.

En «ia» se elige qué IA va primero.
