from vibeshub_client.parse_pr_url import extract_pr_url_from_gh_stdout


def test_extracts_pr_url_from_canonical_gh_stdout():
    stdout = (
        "Creating pull request for branch into main in alice/repo\n"
        "https://github.com/alice/repo/pull/42\n"
    )
    assert extract_pr_url_from_gh_stdout(stdout) == "https://github.com/alice/repo/pull/42"


def test_extracts_pr_url_when_only_url_is_present():
    assert (
        extract_pr_url_from_gh_stdout("https://github.com/x/y/pull/1\n")
        == "https://github.com/x/y/pull/1"
    )


def test_returns_none_when_no_url():
    assert extract_pr_url_from_gh_stdout("error: not a git repo\n") is None


def test_picks_first_url_if_multiple():
    stdout = (
        "https://github.com/x/y/pull/1\n"
        "https://github.com/x/y/pull/2\n"
    )
    assert extract_pr_url_from_gh_stdout(stdout) == "https://github.com/x/y/pull/1"
