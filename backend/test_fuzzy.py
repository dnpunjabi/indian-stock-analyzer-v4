import pytest
from backend.fuzzy_engine import triangle, trapezoid, evaluate_fuzzy_logic

def test_membership_functions():
    # Test triangle
    assert triangle(5.0, 0.0, 5.0, 10.0) == 1.0
    assert triangle(0.0, 0.0, 5.0, 10.0) == 0.0
    assert triangle(10.0, 0.0, 5.0, 10.0) == 0.0
    assert triangle(2.5, 0.0, 5.0, 10.0) == 0.5

    # Test trapezoid
    assert trapezoid(5.0, 2.0, 4.0, 6.0, 8.0) == 1.0
    assert trapezoid(1.0, 2.0, 4.0, 6.0, 8.0) == 0.0
    assert trapezoid(3.0, 2.0, 4.0, 6.0, 8.0) == 0.5
    assert trapezoid(7.0, 2.0, 4.0, 6.0, 8.0) == 0.5

def test_bullish_turnaround_evaluation():
    # Strong fundamental turnaround candidate in Stage 1 Accumulation
    res = evaluate_fuzzy_logic(
        opm_delta=3.5,        # Margins expanding (+3.5%)
        roe_delta=4.0,        # ROE improving (+4.0%)
        debt_delta=-1.2,      # Deleveraging (-1.2 D/E)
        rsi=25.0,             # Oversold (RSI: 25)
        dma_prox=-1.5,        # Near 200-DMA
        adx=15.0,             # Sideways regime
        stage=1,              # Stage 1 Accumulation
        altman_z=4.2,         # Safe zone
        piotroski=8,          # Safe zone
        promoter_holding=65.0,# Safe zone
        promoter_pledge_delta=0.0,
        relative_volume=1.2,
        sector_markdown=False
    )
    assert res["fuzzy_score"] > 20.0
    assert "Buy" in res["rating"]
    assert any(rule["rule_id"] == 202 for rule in res["rule_trail"]) # Early Bird should fire

def test_value_trap_evaluation():
    # Stressed company with compressing margins, borrowing and markdown
    res = evaluate_fuzzy_logic(
        opm_delta=-4.0,       # Margins compressing
        roe_delta=-3.5,       # ROE deteriorating
        debt_delta=1.5,       # Borrowing heavily
        rsi=65.0,
        dma_prox=-8.0,        # Well below 200-DMA
        adx=35.0,             # Trending markdown
        stage=4,              # Stage 4 Markdown
        altman_z=1.2,         # Distressed Z-Score
        piotroski=2,          # Distressed F-Score
        promoter_holding=25.0,# Low holding
        promoter_pledge_delta=4.0,# Heavy pledging increases
        relative_volume=0.9,
        sector_markdown=True
    )
    assert res["fuzzy_score"] <= 20.0  # Capped due to solvency cap (Z < 1.8)
    assert "Sell" in res["rating"] or "Hold" in res["rating"]
    assert any(rule["rule_id"] == 301 for rule in res["rule_trail"]) # Value Trap should fire
    assert any(rule["rule_id"] == 403 for rule in res["rule_trail"]) # Solvency floor should fire

def test_api_fuzzy_endpoints():
    from fastapi.testclient import TestClient
    from backend.main import app
    client = TestClient(app)
    
    # Test universe standings
    response = client.get("/api/fuzzy/universe-standings?limit=2")
    assert response.status_code == 200
    data = response.json()
    assert "top_buys" in data
    assert "top_sells" in data
    
    # Test single stock evaluate
    # Use BTESTB.NS or CONSTRUCTIONMATERIALS.NS as it is guaranteed to be in the database cache
    response = client.get("/api/fuzzy/evaluate?symbol=CONSTRUCTIONMATERIALS.NS")
    assert response.status_code == 200
    eval_data = response.json()
    assert "fuzzy_score" in eval_data
    assert "rating" in eval_data
    assert "inputs" in eval_data
    assert eval_data["inputs"]["symbol"] == "CONSTRUCTIONMATERIALS.NS"
