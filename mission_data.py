"""
mission_data.py — Generador Maestro de Misiones (59 Misiones x 3 Niveles = 177 Objetivos)
Zona Jackpot 777
"""

def _generate_missions():
    missions = []
    
    # helper for creating a 3-level mission
    def add_mission(m_id, name, desc_template, icon, m_type, levels):
        # levels must be a list of 3 tuples: (target, xp, bits)
        missions.append({
            "id": m_id,
            "name": name,
            "desc": desc_template, # e.g. "Juega {target} partidas."
            "icon": icon,
            "type": m_type,
            "levels": [
                {"level": 1, "target": levels[0][0], "xp_reward": levels[0][1], "bits_reward": levels[0][2]},
                {"level": 2, "target": levels[1][0], "xp_reward": levels[1][1], "bits_reward": levels[1][2]},
                {"level": 3, "target": levels[2][0], "xp_reward": levels[2][1], "bits_reward": levels[2][2]}
            ]
        })

    # =======================================================
    # CATEGORÍA 1: ACTIVIDAD GENERAL (Juegos Jugados) - 10 Misiones
    # =======================================================
    add_mission("gen_plays_1", "Debutante", "Juega {target} partidas totales.", "🎮", "juegos_jugados", [(1, 50, 0), (5, 100, 50), (10, 200, 150)])
    add_mission("gen_plays_2", "Constancia", "Juega {target} partidas totales.", "🎮", "juegos_jugados", [(20, 250, 200), (35, 300, 300), (50, 500, 500)])
    add_mission("gen_plays_3", "Veterano", "Juega {target} partidas totales.", "🎮", "juegos_jugados", [(75, 600, 600), (100, 800, 800), (150, 1000, 1000)])
    add_mission("gen_plays_4", "Adicto al Juego", "Juega {target} partidas totales.", "🎮", "juegos_jugados", [(200, 1200, 1200), (300, 1500, 1500), (500, 3000, 2500)])
    add_mission("gen_plays_5", "Leyenda Viva", "Juega {target} partidas totales.", "🎮", "juegos_jugados", [(750, 4000, 4000), (1000, 6000, 6000), (1500, 10000, 10000)])
    
    add_mission("gen_time_1", "El Tiempo Vuela", "Juega por {target} minutos.", "⏱️", "tiempo_jugado", [(5, 50, 50), (15, 100, 100), (30, 200, 200)])
    add_mission("gen_time_2", "Reloj de Arena", "Juega por {target} minutos.", "⏱️", "tiempo_jugado", [(60, 300, 300), (120, 500, 500), (240, 1000, 1000)])
    add_mission("gen_time_3", "Inmortal", "Juega por {target} minutos.", "⏱️", "tiempo_jugado", [(500, 1500, 1500), (1000, 3000, 3000), (2000, 5000, 5000)])
    
    add_mission("gen_diversify_1", "Explorador", "Prueba {target} juegos diferentes.", "🧭", "juegos_diferentes", [(1, 50, 50), (2, 100, 100), (3, 300, 300)])
    add_mission("gen_diversify_2", "Maestro de Juegos", "Juega todos los juegos {target} veces.", "🧭", "juegos_diferentes", [(5, 200, 200), (10, 400, 400), (20, 1000, 1000)]) # Aproximación, usaremos el mismo tracker u otra lógica.

    # =======================================================
    # CATEGORÍA 2: APUESTAS Y BITS (10 Misiones)
    # =======================================================
    add_mission("bits_spent_1", "Inversor Novato", "Apuesta {target} bits en total.", "💸", "bits_apostados", [(100, 50, 0), (500, 100, 50), (1000, 200, 100)])
    add_mission("bits_spent_2", "Apostador", "Apuesta {target} bits en total.", "💸", "bits_apostados", [(5000, 300, 200), (10000, 500, 400), (25000, 1000, 800)])
    add_mission("bits_spent_3", "Ballena Pequeña", "Apuesta {target} bits en total.", "💸", "bits_apostados", [(50000, 1500, 1000), (100000, 3000, 2000), (250000, 5000, 4000)])
    add_mission("bits_spent_4", "Gran Ballena", "Apuesta {target} bits en total.", "💸", "bits_apostados", [(500000, 8000, 6000), (1000000, 15000, 10000), (5000000, 30000, 25000)])
    
    add_mission("bits_won_1", "Primer Botín", "Gana {target} bits en juegos.", "💰", "bits_ganados", [(100, 50, 25), (500, 100, 50), (1000, 200, 100)])
    add_mission("bits_won_2", "Recolector", "Gana {target} bits en juegos.", "💰", "bits_ganados", [(5000, 300, 200), (10000, 500, 400), (25000, 1000, 800)])
    add_mission("bits_won_3", "Comerciante", "Gana {target} bits en juegos.", "💰", "bits_ganados", [(50000, 1500, 1000), (100000, 3000, 2000), (250000, 5000, 4000)])
    add_mission("bits_won_4", "Magnate", "Gana {target} bits en juegos.", "💰", "bits_ganados", [(500000, 8000, 6000), (1000000, 15000, 10000), (2500000, 25000, 20000)])
    add_mission("bits_won_5", "Rey de Midas", "Gana {target} bits en juegos.", "💰", "bits_ganados", [(5000000, 40000, 30000), (10000000, 60000, 50000), (25000000, 100000, 100000)])
    add_mission("bits_won_6", "Trillonario", "Gana {target} bits en juegos.", "💰", "bits_ganados", [(50000000, 200000, 150000), (100000000, 400000, 300000), (500000000, 1000000, 1000000)])

    # =======================================================
    # CATEGORÍA 3: VICTORIAS Y RACHAS (12 Misiones)
    # =======================================================
    add_mission("wins_1", "Primera Sangre", "Gana {target} partidas totales.", "🏆", "wins_total", [(1, 50, 50), (5, 100, 100), (10, 200, 200)])
    add_mission("wins_2", "Luchador", "Gana {target} partidas totales.", "🏆", "wins_total", [(25, 400, 400), (50, 800, 800), (100, 1500, 1500)])
    add_mission("wins_3", "Conquistador", "Gana {target} partidas totales.", "🏆", "wins_total", [(250, 3000, 3000), (500, 5000, 5000), (1000, 10000, 10000)])
    add_mission("wins_4", "Invencible", "Gana {target} partidas totales.", "🏆", "wins_total", [(2000, 15000, 15000), (5000, 30000, 30000), (10000, 50000, 50000)])
    
    add_mission("streak_1", "Calentando", "Consigue una racha de {target} victorias.", "🔥", "win_streak", [(2, 100, 100), (3, 200, 200), (4, 400, 400)])
    add_mission("streak_2", "En Llamas", "Consigue una racha de {target} victorias.", "🔥", "win_streak", [(5, 600, 600), (7, 1000, 1000), (10, 2500, 2500)])
    add_mission("streak_3", "Imparable", "Consigue una racha de {target} victorias.", "🔥", "win_streak", [(12, 4000, 4000), (15, 6000, 6000), (20, 10000, 10000)])
    add_mission("streak_4", "Dios del Casino", "Consigue una racha de {target} victorias.", "🔥", "win_streak", [(25, 15000, 15000), (30, 25000, 25000), (50, 100000, 100000)])

    # Torneos (4 misiones temporales / generales)
    add_mission("tourney_ply_1", "Contendiente", "Juega en {target} torneos.", "⚔️", "tournaments_played", [(1, 200, 100), (5, 600, 300), (10, 1500, 800)])
    add_mission("tourney_ply_2", "Gladiador", "Juega en {target} torneos.", "⚔️", "tournaments_played", [(25, 3000, 1500), (50, 6000, 3000), (100, 15000, 8000)])
    add_mission("tourney_won_1", "Campeón", "Gana {target} torneos.", "👑", "tournaments_won", [(1, 1000, 1000), (3, 3000, 3000), (5, 6000, 6000)])
    add_mission("tourney_won_2", "Leyenda de Arena", "Gana {target} torneos.", "👑", "tournaments_won", [(10, 15000, 15000), (25, 40000, 40000), (50, 100000, 100000)])

    # =======================================================
    # CATEGORÍA 4: MOCHÉ (9 Misiones)
    # =======================================================
    add_mission("moch_win_1", "Aprendiz de Moché", "Gana {target} partidas de Moche.", "🃏", "moches_ganados", [(1, 50, 50), (5, 150, 150), (10, 300, 300)])
    add_mission("moch_win_2", "Mochero", "Gana {target} partidas de Moche.", "🃏", "moches_ganados", [(25, 600, 600), (50, 1500, 1500), (100, 3000, 3000)])
    add_mission("moch_win_3", "Experto en Moche", "Gana {target} partidas de Moche.", "🃏", "moches_ganados", [(250, 6000, 6000), (500, 15000, 15000), (1000, 35000, 35000)])
    add_mission("moch_win_4", "Gran Maestro", "Gana {target} partidas de Moche.", "🃏", "moches_ganados", [(2000, 60000, 60000), (5000, 150000, 150000), (10000, 500000, 500000)])
    
    # Misiones simuladas para relleno (podemos asociarlas al stat moches_ganados si es complejo discriminar)
    add_mission("moch_perf_1", "Moche Impecable", "Gana {target} rondas de Moche.", "🃏", "moches_ganados", [(2, 100, 100), (12, 300, 300), (30, 800, 800)])
    add_mission("moch_perf_2", "Visión Nocturna", "Gana {target} rondas de Moche.", "🃏", "moches_ganados", [(60, 1000, 1000), (120, 2000, 2000), (300, 5000, 5000)])
    add_mission("moch_perf_3", "Telepatía", "Gana {target} rondas de Moche.", "🃏", "moches_ganados", [(500, 10000, 10000), (1000, 25000, 25000), (2500, 60000, 60000)])
    add_mission("moch_perf_4", "Estratega Elite", "Gana {target} rondas de Moche.", "🃏", "moches_ganados", [(5000, 100000, 100000), (10000, 250000, 250000), (25000, 800000, 800000)])
    add_mission("moch_perf_5", "Rey de la Mesa", "Gana {target} rondas de Moche.", "🃏", "moches_ganados", [(50000, 1000000, 1000000), (100000, 3000000, 3000000), (500000, 10000000, 10000000)])

    # =======================================================
    # CATEGORÍA 5: RULETA (9 Misiones)
    # =======================================================
    add_mission("rul_win_1", "Giro Suerte", "Gana {target} rondas de Ruleta.", "🎡", "ruletas_ganadas", [(1, 50, 50), (5, 150, 150), (10, 300, 300)])
    add_mission("rul_win_2", "Apostador de Ruleta", "Gana {target} rondas de Ruleta.", "🎡", "ruletas_ganadas", [(25, 600, 600), (50, 1500, 1500), (100, 3000, 3000)])
    add_mission("rul_win_3", "Crupier", "Gana {target} rondas de Ruleta.", "🎡", "ruletas_ganadas", [(250, 6000, 6000), (500, 15000, 15000), (1000, 35000, 35000)])
    add_mission("rul_win_4", "Dueño de la Mesa", "Gana {target} rondas de Ruleta.", "🎡", "ruletas_ganadas", [(2000, 60000, 60000), (5000, 150000, 150000), (10000, 500000, 500000)])
    
    add_mission("rul_perf_1", "Ruleta Rusa", "Gana {target} veces en Ruleta.", "🎡", "ruletas_ganadas", [(2, 100, 100), (12, 300, 300), (30, 800, 800)])
    add_mission("rul_perf_2", "Rojo o Negro", "Gana {target} veces en Ruleta.", "🎡", "ruletas_ganadas", [(60, 1000, 1000), (120, 2000, 2000), (300, 5000, 5000)])
    add_mission("rul_perf_3", "Buscando Plenos", "Gana {target} veces en Ruleta.", "🎡", "ruletas_ganadas", [(500, 10000, 10000), (1000, 25000, 25000), (2500, 60000, 60000)])
    add_mission("rul_perf_4", "Física Cuántica", "Gana {target} veces en Ruleta.", "🎡", "ruletas_ganadas", [(5000, 100000, 100000), (10000, 250000, 250000), (25000, 800000, 800000)])
    add_mission("rul_perf_5", "Oráculo", "Gana {target} veces en Ruleta.", "🎡", "ruletas_ganadas", [(50000, 1000000, 1000000), (100000, 3000000, 3000000), (500000, 10000000, 10000000)])

    # =======================================================
    # CATEGORÍA 6: SLOTS Y JACKPOTS (9 Misiones)
    # =======================================================
    add_mission("jackpot_1", "Suerte de Principiante", "Consigue {target} Jackpots.", "🎰", "jackpots_ganados", [(1, 200, 100), (3, 500, 300), (5, 1000, 600)])
    add_mission("jackpot_2", "Tirador Frecuente", "Consigue {target} Jackpots.", "🎰", "jackpots_ganados", [(10, 2000, 1200), (25, 6000, 3500), (50, 15000, 8000)])
    add_mission("jackpot_3", "Caza-Tesoros", "Consigue {target} Jackpots.", "🎰", "jackpots_ganados", [(100, 35000, 20000), (250, 80000, 50000), (500, 200000, 150000)])
    add_mission("jackpot_4", "Máquina Humana", "Consigue {target} Jackpots.", "🎰", "jackpots_ganados", [(1000, 500000, 400000), (2500, 1500000, 1000000), (5000, 4000000, 3000000)])

    add_mission("slot_win_1", "777", "Gana premio en Slots {target} veces.", "🎰", "jackpots_ganados", [(10, 100, 100), (30, 250, 250), (50, 500, 500)]) # En ausencia de "slots won", usamos jackpot por ahora o juegos jugados
    add_mission("slot_win_2", "Lluvia de Monedas", "Gana premio en Slots {target} veces.", "🎰", "jackpots_ganados", [(100, 1000, 1000), (250, 3000, 3000), (500, 6000, 6000)])
    add_mission("slot_win_3", "Dueño del Casino", "Gana premio en Slots {target} veces.", "🎰", "jackpots_ganados", [(1000, 15000, 15000), (2500, 40000, 40000), (5000, 100000, 100000)])
    add_mission("slot_win_4", "Crupier Automático", "Gana premio en Slots {target} veces.", "🎰", "jackpots_ganados", [(10000, 250000, 250000), (25000, 800000, 800000), (50000, 2000000, 2000000)])
    add_mission("slot_win_5", "El Hacker", "Gana premio en Slots {target} veces.", "🎰", "jackpots_ganados", [(100000, 5000000, 5000000), (250000, 15000000, 15000000), (500000, 40000000, 40000000)])

    return missions

MISSIONS = _generate_missions()
