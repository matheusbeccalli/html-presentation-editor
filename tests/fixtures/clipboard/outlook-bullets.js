// SYNTHETIC: hand-written to look like Outlook (Word engine) clipboard HTML: MsoListParagraph, <o:p>.
CLIPBOARD_FIXTURES.push({
    name: 'outlook-bullets',
    source: 'Outlook 365 on Windows (synthetic)',
    synthetic: true,
    types: {
        'text/html': '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns="http://www.w3.org/TR/REC-html40"><head><meta name=Generator content="Microsoft Word 15 (filtered medium)"></head><body lang=PT-BR link="#0563C1"><!--StartFragment--><p class=MsoNormal>Olá equipe,<o:p></o:p></p><p class=MsoListParagraph style=\'text-indent:-18.0pt;mso-list:l0 level1 lfo1\'><![if !supportLists]><span style=\'font-family:Symbol\'><span style=\'mso-list:Ignore\'>·<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp; </span></span></span><![endif]>Ver o <a href="https://example.com/modelo">modelo</a><o:p></o:p></p><p class=MsoListParagraph style=\'margin-left:72.0pt;text-indent:-18.0pt;mso-list:l0 level2 lfo1\'><![if !supportLists]><span style=\'font-family:"Courier New"\'><span style=\'mso-list:Ignore\'>o<span style=\'font:7.0pt "Times New Roman"\'>&nbsp;&nbsp; </span></span></span><![endif]><span style=\'color:#1F3864\'>Aba de premissas</span><o:p></o:p></p><!--EndFragment--></body></html>',
        'text/plain': 'Olá equipe,\r\n\r\n·         Ver o modelo\r\no    Aba de premissas\r\n',
    },
});
