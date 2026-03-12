import os

templates_dir = r'c:\Users\Cronos\Desktop\telegram_webapp\templates'
templates = ['index.html', 'juegos.html', 'slotmachine.html', 'ruleta.html', 'moche.html', 'blackjack.html']

theme_link = '  <link rel="stylesheet" href="/static/css/themes.css">\n'
theme_script = '  <script>try{var t=localStorage.getItem("casino_theme");if(t)document.documentElement.setAttribute("data-casino-theme",t);}catch(e){}</script>\n'

for fname in templates:
    path = os.path.join(templates_dir, fname)
    if not os.path.exists(path):
        print(f'SKIP (not found): {fname}')
        continue
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()

    changed = False

    # Add themes.css link after style.css if not already present
    if 'themes.css' not in content:
        content = content.replace(
            '<link rel="stylesheet" href="/static/css/style.css">',
            '<link rel="stylesheet" href="/static/css/style.css">\n' + theme_link
        )
        changed = True

    # Add inline theme script before </head> if not already there
    if 'casino_theme' not in content:
        content = content.replace('</head>', theme_script + '</head>')
        changed = True

    # Update <body> to include data-casino-theme from Jinja2
    if 'data-casino-theme' not in content:
        content = content.replace(
            '<body>',
            '<body {% if global_profile and global_profile.tema_actual %}data-casino-theme="{{ global_profile.tema_actual }}"{% endif %}>'
        )
        changed = True

    if changed:
        with open(path, 'w', encoding='utf-8') as f:
            f.write(content)
        print(f'Updated: {fname}')
    else:
        print(f'Already up to date: {fname}')

print("Done!")
